"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionId = powerbi.visuals.ISelectionId;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import VisualDataChangeOperationKind = powerbi.VisualDataChangeOperationKind;

import { VisualFormattingSettingsModel } from "./settings";

interface ParetoPoint {
    name: string;
    value: number;
    rank: number;
    cumulativeShare: number;
    selectionId: ISelectionId;
    extraTooltipItems: VisualTooltipDataItem[];
}

interface Margins {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export class Visual implements IVisual {
    private readonly host: IVisualHost;
    private readonly events: IVisualEventService;
    private readonly target: HTMLElement;
    private readonly svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private readonly emptyState: HTMLDivElement;
    private readonly warning: HTMLDivElement;
    private readonly formattingSettingsService: FormattingSettingsService;
    private formattingSettings: VisualFormattingSettingsModel;
    private readonly numberFormatter: Intl.NumberFormat;
    private fetchPending = false;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.target = options.element;
        this.target.classList.add("pareto-visual");

        this.svg = d3.select(this.target)
            .append("svg")
            .attr("class", "pareto-chart");

        this.emptyState = document.createElement("div");
        this.emptyState.className = "pareto-empty";
        this.target.appendChild(this.emptyState);

        this.warning = document.createElement("div");
        this.warning.className = "pareto-warning";
        this.target.appendChild(this.warning);

        this.formattingSettingsService = new FormattingSettingsService();
        this.formattingSettings = new VisualFormattingSettingsModel();
        this.numberFormatter = new Intl.NumberFormat(options.host.locale, {
            maximumFractionDigits: 2
        });
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);

        try {
            const dataView = options.dataViews?.[0];
            if (options.operationKind === VisualDataChangeOperationKind.Create
                || options.operationKind === VisualDataChangeOperationKind.Append
                || options.operationKind === VisualDataChangeOperationKind.Segment) {
                this.fetchPending = false;
            }
            this.formattingSettings = dataView
                ? this.formattingSettingsService.populateFormattingSettingsModel(
                    VisualFormattingSettingsModel,
                    dataView
                )
                : new VisualFormattingSettingsModel();

            this.svg.selectAll("*").remove();
            this.host.tooltipService.hide({ immediately: true, isTouchEvent: false });
            this.hideMessages();

            const width = Math.max(0, options.viewport.width);
            const height = Math.max(0, options.viewport.height);
            this.svg.attr("width", width).attr("height", height);

            const points = this.buildPoints(dataView);
            if (!this.hasRequiredFields(dataView)) {
                this.showEmpty("请添加“门店”和“销售额”字段");
            } else if (points.length === 0) {
                this.showEmpty("当前筛选条件下没有正数销售额");
            } else if (width < 180 || height < 120) {
                this.showEmpty("请增大视觉对象尺寸");
            } else {
                this.renderChart(points, width, height);
                this.fetchRemainingSegments(dataView, points.length);
            }

            this.events.renderingFinished(options);
        } catch (error) {
            this.showEmpty("视觉对象渲染失败");
            this.events.renderingFailed(options, String(error));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    private fetchRemainingSegments(dataView: powerbi.DataView, loadedCount: number): void {
        if (!dataView.metadata.segment) {
            this.fetchPending = false;
            return;
        }

        let accepted = this.fetchPending;
        if (!this.fetchPending) {
            accepted = this.host.fetchMoreData(true);
            this.fetchPending = accepted;
        }

        if (accepted) {
            this.showWarning(`正在加载完整数据（已加载 ${loadedCount.toLocaleString()} 家门店）…`);
        } else {
            this.showWarning("已达到 Power BI 分段取数内存上限，曲线可能不完整");
        }
    }

    private buildPoints(dataView: powerbi.DataView | undefined): ParetoPoint[] {
        const table = dataView?.table;
        if (table?.columns?.length && table.rows?.length) {
            return this.buildTablePoints(table);
        }

        const category = dataView?.categorical?.categories?.[0];
        const categoricalValues = dataView?.categorical?.values;
        const values = categoricalValues?.find(column => column.source.roles?.measure)
            ?? categoricalValues?.[0];
        if (!category || !values) {
            return [];
        }

        const tooltipColumns = categoricalValues
            ? Array.from(categoricalValues).filter(column => column.source.roles?.tooltips)
            : [];

        const rawPoints = category.values
            .map((categoryValue, index) => {
                const numericValue = Number(values.values[index]);
                if (!Number.isFinite(numericValue) || numericValue <= 0) {
                    return null;
                }

                return {
                    name: categoryValue === null || categoryValue === undefined
                        ? "(空白)"
                        : String(categoryValue),
                    value: numericValue,
                    selectionId: this.host.createSelectionIdBuilder()
                        .withCategory(category, index)
                        .createSelectionId(),
                    extraTooltipItems: tooltipColumns.map(column => ({
                        displayName: column.source.displayName,
                        value: valueFormatter.format(
                            column.values[index],
                            column.source.format,
                            true,
                            this.host.locale
                        )
                    }))
                };
            })
            .filter((point): point is NonNullable<typeof point> => point !== null)
            .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name));

        const total = d3.sum(rawPoints, point => point.value);
        let runningTotal = 0;

        return rawPoints.map((point, index) => {
            runningTotal += point.value;
            return {
                name: point.name,
                value: point.value,
                rank: index + 1,
                cumulativeShare: total > 0 ? runningTotal / total : 0,
                selectionId: point.selectionId,
                extraTooltipItems: point.extraTooltipItems
            };
        });
    }

    private buildTablePoints(table: powerbi.DataViewTable): ParetoPoint[] {
        const categoryIndex = table.columns.findIndex(column => column.roles?.category);
        const measureIndex = table.columns.findIndex(column => column.roles?.measure);
        if (categoryIndex < 0 || measureIndex < 0 || !table.rows) {
            return [];
        }

        const tooltipIndexes = table.columns
            .map((column, index) => column.roles?.tooltips ? index : -1)
            .filter(index => index >= 0);

        const rawPoints = table.rows
            .map((row, rowIndex) => {
                const numericValue = Number(row[measureIndex]);
                if (!Number.isFinite(numericValue) || numericValue <= 0) {
                    return null;
                }

                const categoryValue = row[categoryIndex];
                return {
                    name: categoryValue === null || categoryValue === undefined
                        ? "(空白)"
                        : String(categoryValue),
                    value: numericValue,
                    selectionId: this.host.createSelectionIdBuilder()
                        .withTable(table, rowIndex)
                        .createSelectionId(),
                    extraTooltipItems: tooltipIndexes.map(columnIndex => ({
                        displayName: table.columns[columnIndex].displayName,
                        value: valueFormatter.format(
                            row[columnIndex],
                            table.columns[columnIndex].format,
                            true,
                            this.host.locale
                        )
                    }))
                };
            })
            .filter((point): point is NonNullable<typeof point> => point !== null)
            .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name));

        const total = d3.sum(rawPoints, point => point.value);
        let runningTotal = 0;

        return rawPoints.map((point, index) => {
            runningTotal += point.value;
            return {
                name: point.name,
                value: point.value,
                rank: index + 1,
                cumulativeShare: total > 0 ? runningTotal / total : 0,
                selectionId: point.selectionId,
                extraTooltipItems: point.extraTooltipItems
            };
        });
    }

    private hasRequiredFields(dataView: powerbi.DataView | undefined): boolean {
        if (dataView?.table?.columns?.length) {
            const columns = dataView.table.columns;
            return columns.some(column => column.roles?.category)
                && columns.some(column => column.roles?.measure);
        }

        return Boolean(
            dataView?.categorical?.categories?.length
            && dataView.categorical.values?.some(column => column.source.roles?.measure)
        );
    }

    private renderChart(points: ParetoPoint[], width: number, height: number): void {
        const axisFontSize = this.clamp(this.formattingSettings.axesCard.fontSize.value, 8, 24);
        const margins: Margins = {
            top: this.formattingSettings.dataLabelsCard.show.value ? 24 : 12,
            right: 18,
            bottom: 34,
            left: 50
        };
        const innerWidth = Math.max(1, width - margins.left - margins.right);
        const innerHeight = Math.max(1, height - margins.top - margins.bottom);
        const maxRank = Math.max(2, points.length);

        const xScale = d3.scaleLinear()
            .domain([1, maxRank])
            .range([0, innerWidth]);
        const yScale = d3.scaleLinear()
            .domain([0, 1])
            .range([innerHeight, 0]);

        const chart = this.svg.append("g")
            .attr("transform", `translate(${margins.left},${margins.top})`);

        if (this.formattingSettings.axesCard.showGridlines.value) {
            chart.append("g")
                .attr("class", "grid-lines")
                .call(
                    d3.axisLeft(yScale)
                        .ticks(Math.max(3, Math.floor(innerHeight / 70)))
                        .tickSize(-innerWidth)
                        .tickFormat(() => "")
                );
        }

        const xAxis = d3.axisBottom(xScale)
            .ticks(Math.max(2, Math.min(8, Math.floor(innerWidth / 90))))
            .tickFormat(value => Math.round(Number(value)).toLocaleString());
        const yAxis = d3.axisLeft(yScale)
            .ticks(Math.max(3, Math.floor(innerHeight / 70)))
            .tickFormat(d3.format(".0%"));

        chart.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${innerHeight})`)
            .call(xAxis);
        chart.append("g")
            .attr("class", "y-axis")
            .call(yAxis);

        chart.selectAll<SVGTextElement, unknown>(".x-axis text, .y-axis text")
            .style("font-size", `${axisFontSize}px`);

        if (this.formattingSettings.referenceLineCard.show.value) {
            const referenceValue = this.clamp(this.formattingSettings.referenceLineCard.value.value, 0, 1);
            const referenceColor = this.formattingSettings.referenceLineCard.color.value.value;
            chart.append("line")
                .attr("class", "reference-line")
                .attr("x1", 0)
                .attr("x2", innerWidth)
                .attr("y1", yScale(referenceValue))
                .attr("y2", yScale(referenceValue))
                .attr("stroke", referenceColor);
            chart.append("text")
                .attr("class", "reference-label")
                .attr("x", innerWidth - 3)
                .attr("y", yScale(referenceValue) - 4)
                .attr("text-anchor", "end")
                .attr("fill", referenceColor)
                .text(d3.format(".0%")(referenceValue));
        }

        if (this.formattingSettings.countReferenceLineCard.show.value) {
            const countValue = Math.round(this.formattingSettings.countReferenceLineCard.value.value);
            if (countValue >= 1 && countValue <= points.length) {
                const countColor = this.formattingSettings.countReferenceLineCard.color.value.value;
                chart.append("line")
                    .attr("class", "count-reference-line")
                    .attr("x1", xScale(countValue))
                    .attr("x2", xScale(countValue))
                    .attr("y1", 0)
                    .attr("y2", innerHeight)
                    .attr("stroke", countColor);
                chart.append("text")
                    .attr("class", "count-reference-label")
                    .attr("x", xScale(countValue) + 4)
                    .attr("y", 11)
                    .attr("fill", countColor)
                    .text(`X = ${countValue.toLocaleString()}`);
            }
        }

        const lineGenerator = d3.line<ParetoPoint>()
            .x(point => xScale(point.rank))
            .y(point => yScale(point.cumulativeShare))
            .curve(d3.curveMonotoneX);

        const lineColor = this.formattingSettings.lineCard.color.value.value;
        const renderPoints = this.sampleForRendering(points, xScale, innerWidth);
        chart.append("path")
            .datum(renderPoints)
            .attr("class", "pareto-line")
            .attr("d", lineGenerator)
            .attr("stroke", lineColor)
            .attr("stroke-width", this.clamp(this.formattingSettings.lineCard.width.value, 1, 8));

        this.renderLabels(chart, points, xScale, yScale, innerWidth, innerHeight);
        this.renderHoverLayer(chart, points, xScale, yScale, innerWidth, innerHeight, lineColor);
    }

    private sampleForRendering(
        points: ParetoPoint[],
        xScale: d3.ScaleLinear<number, number>,
        innerWidth: number
    ): ParetoPoint[] {
        if (points.length <= innerWidth * 2) {
            return points;
        }

        const sampled: ParetoPoint[] = [];
        let currentBucket = -1;
        let firstInBucket: ParetoPoint | undefined;
        let lastInBucket: ParetoPoint | undefined;

        const flushBucket = (): void => {
            if (!firstInBucket || !lastInBucket) {
                return;
            }
            sampled.push(firstInBucket);
            if (lastInBucket !== firstInBucket) {
                sampled.push(lastInBucket);
            }
        };

        for (const point of points) {
            const bucket = Math.min(Math.floor(innerWidth), Math.floor(xScale(point.rank)));
            if (bucket !== currentBucket) {
                flushBucket();
                currentBucket = bucket;
                firstInBucket = point;
            }
            lastInBucket = point;
        }
        flushBucket();

        return sampled;
    }

    private renderLabels(
        chart: d3.Selection<SVGGElement, unknown, null, undefined>,
        points: ParetoPoint[],
        xScale: d3.ScaleLinear<number, number>,
        yScale: d3.ScaleLinear<number, number>,
        innerWidth: number,
        innerHeight: number
    ): void {
        if (!this.formattingSettings.dataLabelsCard.show.value) {
            return;
        }

        const requestedCount = Math.round(this.formattingSettings.dataLabelsCard.count.value);
        const labelCount = this.clamp(requestedCount, 2, Math.min(20, points.length));
        const indexes = new Set<number>();
        for (let i = 0; i < labelCount; i += 1) {
            indexes.add(Math.round(i * (points.length - 1) / Math.max(1, labelCount - 1)));
        }

        const labelPoints = Array.from(indexes).map(index => points[index]);
        chart.append("g")
            .attr("class", "data-labels")
            .selectAll("text")
            .data(labelPoints)
            .join("text")
            .attr("x", point => this.clamp(xScale(point.rank), 18, innerWidth - 18))
            .attr("y", point => this.clamp(yScale(point.cumulativeShare) - 7, 9, innerHeight - 5))
            .attr("text-anchor", "middle")
            .style("font-size", `${this.clamp(this.formattingSettings.dataLabelsCard.fontSize.value, 8, 22)}px`)
            .text(point => d3.format(".2%")(point.cumulativeShare));
    }

    private renderHoverLayer(
        chart: d3.Selection<SVGGElement, unknown, null, undefined>,
        points: ParetoPoint[],
        xScale: d3.ScaleLinear<number, number>,
        yScale: d3.ScaleLinear<number, number>,
        innerWidth: number,
        innerHeight: number,
        lineColor: string
    ): void {
        const hoverLine = chart.append("line")
            .attr("class", "hover-line")
            .attr("y1", 0)
            .attr("y2", innerHeight)
            .style("display", "none");
        const hoverPoint = chart.append("circle")
            .attr("class", "hover-point")
            .attr("r", 4.5)
            .attr("fill", "#FFFFFF")
            .attr("stroke", lineColor)
            .style("display", "none");

        const overlay = chart.append("rect")
            .attr("class", "hover-overlay")
            .attr("width", innerWidth)
            .attr("height", innerHeight);

        const pointFromEvent = (event: PointerEvent): ParetoPoint => {
            const [mouseX] = d3.pointer(event, overlay.node());
            const rank = this.clamp(Math.round(xScale.invert(mouseX)), 1, points.length);
            return points[rank - 1];
        };

        const tooltipItems = (point: ParetoPoint): VisualTooltipDataItem[] => [
            { displayName: "门店", value: point.name, header: point.name },
            { displayName: "销售额", value: this.numberFormatter.format(point.value) },
            { displayName: "X（排名）", value: point.rank.toLocaleString() },
            { displayName: "Y（累计占比）", value: d3.format(".2%")(point.cumulativeShare) },
            ...point.extraTooltipItems
        ];

        const positionHover = (point: ParetoPoint): void => {
            hoverLine
                .attr("x1", xScale(point.rank))
                .attr("x2", xScale(point.rank))
                .style("display", null);
            hoverPoint
                .attr("cx", xScale(point.rank))
                .attr("cy", yScale(point.cumulativeShare))
                .style("display", null);
        };

        overlay
            .on("pointerenter", (event: PointerEvent) => {
                const point = pointFromEvent(event);
                positionHover(point);
                this.host.tooltipService.show({
                    coordinates: d3.pointer(event, this.target),
                    isTouchEvent: event.pointerType === "touch",
                    dataItems: tooltipItems(point),
                    identities: [point.selectionId]
                });
            })
            .on("pointermove", (event: PointerEvent) => {
                const point = pointFromEvent(event);
                positionHover(point);
                this.host.tooltipService.move({
                    coordinates: d3.pointer(event, this.target),
                    isTouchEvent: event.pointerType === "touch",
                    dataItems: tooltipItems(point),
                    identities: [point.selectionId]
                });
            })
            .on("pointerleave", () => {
                hoverLine.style("display", "none");
                hoverPoint.style("display", "none");
                this.host.tooltipService.hide({ immediately: true, isTouchEvent: false });
            });
    }

    private hideMessages(): void {
        this.emptyState.style.display = "none";
        this.warning.style.display = "none";
    }

    private showEmpty(message: string): void {
        this.emptyState.textContent = message;
        this.emptyState.style.display = "flex";
    }

    private showWarning(message: string): void {
        this.warning.textContent = message;
        this.warning.style.display = "block";
    }

    private clamp(value: number, minimum: number, maximum: number): number {
        return Math.max(minimum, Math.min(maximum, value));
    }
}
