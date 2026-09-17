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
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import VisualDataChangeOperationKind = powerbi.VisualDataChangeOperationKind;
import VisualUpdateType = powerbi.VisualUpdateType;

import { VisualFormattingSettingsModel } from "./settings";

interface ParetoPoint {
    name: string;
    value: number;
    rank: number;
    currentShare: number;
    cumulativeShare: number;
    highlightValue?: number;
    highlightCumulativeShare?: number;
    measureFormat?: string;
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
    private static instanceCounter = 0;
    private readonly host: IVisualHost;
    private readonly events: IVisualEventService;
    private readonly target: HTMLElement;
    private readonly svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private readonly emptyState: HTMLDivElement;
    private readonly warning: HTMLDivElement;
    private readonly formattingSettingsService: FormattingSettingsService;
    private readonly selectionManager: ISelectionManager;
    private readonly localizationManager: ILocalizationManager;
    private readonly allowInteractions: boolean;
    private isHighContrast: boolean;
    private foregroundColor: string;
    private backgroundColor: string;
    private foregroundSelectedColor: string;
    private formattingSettings: VisualFormattingSettingsModel;
    private fetchPending = false;
    private cachedPoints: ParetoPoint[] = [];
    private tooltipCache = new Map<number, VisualTooltipDataItem[]>();
    private selectedKeys = new Set<string>();
    private categoryDisplayName: string;
    private measureDisplayName: string;
    private dataWarning: string | undefined;
    private readonly clipPathId: string;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.localizationManager = options.host.createLocalizationManager();
        this.allowInteractions = options.host.hostCapabilities.allowInteractions;
        this.refreshHostColors();
        this.target = options.element;
        this.clipPathId = `pareto-plot-clip-${++Visual.instanceCounter}`;
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

        this.formattingSettingsService = new FormattingSettingsService(this.localizationManager);
        this.formattingSettings = new VisualFormattingSettingsModel();
        this.selectionManager.registerOnSelectCallback(ids => {
            this.updateSelectedKeys(ids as unknown as ISelectionId[]);
        });
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);

        try {
            const dataView = options.dataViews?.[0];
            this.refreshHostColors();
            const resizeFlags = VisualUpdateType.Resize | VisualUpdateType.ResizeEnd;
            const updateType = Number(options.type);
            const isResizeOnly = updateType !== 0 && (updateType & ~resizeFlags) === 0;
            const isResizeEnd = (options.type & VisualUpdateType.ResizeEnd) !== 0;
            const width = Math.max(0, options.viewport.width);
            const height = Math.max(0, options.viewport.height);
            this.svg.attr("width", width).attr("height", height);

            if (isResizeOnly && !isResizeEnd) {
                this.events.renderingFinished(options);
                return;
            }

            if (options.operationKind === VisualDataChangeOperationKind.Create
                || options.operationKind === VisualDataChangeOperationKind.Append
                || options.operationKind === VisualDataChangeOperationKind.Segment) {
                this.fetchPending = false;
            }
            if (dataView) {
                this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
                    VisualFormattingSettingsModel,
                    dataView
                );
                this.applyExplicitTitleSettings(dataView);
                this.applyLocalizedTitleDefaults(dataView);
                this.applyLegacySettings(dataView);
                this.applyThemeDefaults(dataView);
                this.updateDisplayNames(dataView);
            } else if (this.cachedPoints.length === 0) {
                this.formattingSettings = new VisualFormattingSettingsModel();
            }

            this.svg.selectAll("*").remove();
            this.host.tooltipService.hide({ immediately: true, isTouchEvent: false });
            this.hideMessages();

            if (dataView && !this.hasRequiredFields(dataView)) {
                this.cachedPoints = [];
                this.showEmpty(this.t("Message_AddFields"));
            } else if (!dataView && this.cachedPoints.length === 0) {
                this.showEmpty(this.t("Message_AddFields"));
            } else if (dataView?.metadata.segment) {
                this.cachedPoints = [];
                this.tooltipCache.clear();
                const loadedCount = dataView.table?.rows?.length
                    ?? dataView.categorical?.categories?.[0]?.values.length
                    ?? 0;
                const fetching = this.fetchRemainingSegments(dataView, loadedCount);
                if (!fetching && width >= 180 && height >= 120) {
                    this.cachedPoints = this.buildPoints(dataView);
                    if (this.cachedPoints.length > 0) {
                        this.renderChart(this.cachedPoints, width, height);
                    }
                }
            } else if (width < 180 || height < 120) {
                this.showEmpty(this.t("Message_IncreaseSize"));
            } else {
                const dataChanged = (options.type & VisualUpdateType.Data) !== 0
                    || this.cachedPoints.length === 0;
                if (dataChanged && dataView) {
                    this.tooltipCache.clear();
                    this.cachedPoints = this.buildPoints(dataView);
                }
                const points = this.cachedPoints;
                if (points.length === 0) {
                    this.showEmpty(this.t("Message_NoPositiveValues"));
                    this.events.renderingFinished(options);
                    return;
                }
                this.renderChart(points, width, height);
                if (this.dataWarning) {
                    this.showWarning(this.dataWarning);
                }
            }

            this.events.renderingFinished(options);
        } catch (error) {
            this.showEmpty(this.t("Message_RenderFailed"));
            this.events.renderingFailed(options, String(error));
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    private fetchRemainingSegments(dataView: powerbi.DataView, loadedCount: number): boolean {
        if (!dataView.metadata.segment) {
            this.fetchPending = false;
            return false;
        }

        let accepted = this.fetchPending;
        if (!this.fetchPending) {
            accepted = this.host.fetchMoreData(true);
            this.fetchPending = accepted;
        }

        if (accepted) {
            this.showEmpty(this.t("Message_Loading"));
            this.showWarning(this.t("Message_LoadingCount")
                .replace("{count}", loadedCount.toLocaleString(this.host.locale))
                .replace("{category}", this.categoryDisplayName));
        } else {
            this.showWarning(this.t("Message_MemoryLimit"));
        }
        return accepted;
    }

    private buildPoints(dataView: powerbi.DataView | undefined): ParetoPoint[] {
        this.dataWarning = undefined;
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

        this.categoryDisplayName = category.source.displayName || this.t("Role_Category");
        this.measureDisplayName = values.source.displayName || this.t("Role_Measure");

        const tooltipColumns = categoricalValues
            ? Array.from(categoricalValues).filter(column => column.source.roles?.tooltips)
            : [];
        const measureFormat = values.source.format;
        const highlights = values.highlights;

        const rawPoints = category.values
            .map((categoryValue, index) => {
                const numericValue = Number(values.values[index]);
                const numericHighlight = highlights ? Number(highlights[index]) : undefined;
                if (!Number.isFinite(numericValue) || numericValue <= 0) {
                    return null;
                }

                return {
                    name: categoryValue === null || categoryValue === undefined
                        ? this.t("Text_Blank")
                        : String(categoryValue),
                    value: numericValue,
                    highlightValue: highlights
                        ? (Number.isFinite(numericHighlight) ? Math.max(0, numericHighlight ?? 0) : 0)
                        : undefined,
                    measureFormat,
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
        const highlightTotal = d3.sum(rawPoints, point => point.highlightValue ?? 0);
        let runningTotal = 0;
        let runningHighlightTotal = 0;

        return rawPoints.map((point, index) => {
            runningTotal += point.value;
            runningHighlightTotal += point.highlightValue ?? 0;
            return {
                name: point.name,
                value: point.value,
                measureFormat: point.measureFormat,
                rank: index + 1,
                currentShare: total > 0 ? point.value / total : 0,
                cumulativeShare: total > 0 ? runningTotal / total : 0,
                highlightValue: point.highlightValue,
                highlightCumulativeShare: point.highlightValue !== undefined && highlightTotal > 0
                    ? runningHighlightTotal / highlightTotal
                    : undefined,
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

        const measureFormat = table.columns[measureIndex].format;
        this.categoryDisplayName = table.columns[categoryIndex].displayName || this.t("Role_Category");
        this.measureDisplayName = table.columns[measureIndex].displayName || this.t("Role_Measure");
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
                        ? this.t("Text_Blank")
                        : String(categoryValue),
                    value: numericValue,
                    measureFormat,
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

        if (new Set(rawPoints.map(point => point.name)).size < rawPoints.length) {
            this.dataWarning = this.t("Message_DuplicateCategories");
        }

        const total = d3.sum(rawPoints, point => point.value);
        let runningTotal = 0;

        return rawPoints.map((point, index) => {
            runningTotal += point.value;
            return {
                name: point.name,
                value: point.value,
                measureFormat: point.measureFormat,
                rank: index + 1,
                currentShare: total > 0 ? point.value / total : 0,
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
        const xAxisSettings = this.formattingSettings.xAxisCard;
        const valueAxisSettings = this.formattingSettings.valueAxisCard;
        const percentageAxisSettings = this.formattingSettings.percentageAxisCard;
        const showBars = this.formattingSettings.salesBarsCard.show.value;
        const showSalesLabels = showBars && this.formattingSettings.salesLabelsCard.show.value;
        const showValueAxis = showBars && valueAxisSettings.show.value;
        const percentagePosition = percentageAxisSettings.position.value === "right" ? "right" : "left";
        const requestedValuePosition = valueAxisSettings.position.value === "left" ? "left" : "right";
        const valuePosition = requestedValuePosition === percentagePosition
            ? (percentagePosition === "left" ? "right" : "left")
            : requestedValuePosition;
        const maxValue = d3.max(points, point => point.value) ?? 0;
        const hasHighlights = points.some(point => point.highlightValue !== undefined);
        const highlightColor = this.isHighContrast
            ? this.foregroundSelectedColor
            : this.host.colorPalette.getColor("pareto-highlight").value;
        const measureFormat = points[0]?.measureFormat;
        const axisValueFormatter = this.createValueFormatter(
            measureFormat,
            maxValue,
            Number(valueAxisSettings.displayUnits.value),
            valueAxisSettings.decimalPlaces.value
        );
        const labelValueFormatter = this.createValueFormatter(
            measureFormat,
            maxValue,
            Number(this.formattingSettings.salesLabelsCard.displayUnits.value),
            this.formattingSettings.salesLabelsCard.decimalPlaces.value
        );
        const percentageDecimals = this.clamp(Math.round(percentageAxisSettings.decimalPlaces.value), 0, 4);
        const formatPercent = (value: number): string => this.formatPercentage(value, percentageDecimals);
        const valueAxisLabelWidth = showValueAxis
            ? Math.min(126, Math.max(54, axisValueFormatter.format(maxValue).length * 7 + 12))
            : 12;
        const percentageAxisWidth = percentageAxisSettings.show.value
            ? 48 + (percentageAxisSettings.showTitle.value ? 18 : 0)
            : 12;
        const valueAxisWidth = valueAxisLabelWidth + (showValueAxis && valueAxisSettings.showTitle.value ? 18 : 0);
        const margins: Margins = {
            top: 12 + (this.formattingSettings.dataLabelsCard.show.value || showSalesLabels ? 16 : 0),
            right: (percentagePosition === "right" ? percentageAxisWidth : 12)
                + (showValueAxis && valuePosition === "right" ? valueAxisWidth : 0),
            bottom: 34 + (xAxisSettings.show.value && xAxisSettings.showTitle.value ? 16 : 0),
            left: (percentagePosition === "left" ? percentageAxisWidth : 12)
                + (showValueAxis && valuePosition === "left" ? valueAxisWidth : 0)
        };
        const innerWidth = Math.max(1, width - margins.left - margins.right);
        const innerHeight = Math.max(1, height - margins.top - margins.bottom);
        const xScale = d3.scaleLinear()
            .domain([0.5, points.length + 0.5])
            .range([0, innerWidth]);
        const yScale = d3.scaleLinear()
            .domain([0, 1])
            .range([innerHeight, 0]);
        const useCustomRange = valueAxisSettings.rangeMode.value === "custom"
            && Number.isFinite(valueAxisSettings.start.value)
            && Number.isFinite(valueAxisSettings.end.value)
            && valueAxisSettings.end.value > valueAxisSettings.start.value;
        const valueDomain: [number, number] = useCustomRange
            ? [valueAxisSettings.start.value, valueAxisSettings.end.value]
            : [0, maxValue > 0 ? maxValue : 1];
        const valueScale = d3.scaleLinear()
            .domain(valueDomain)
            .range([innerHeight, 0]);
        if (!useCustomRange) {
            valueScale.nice();
        }

        const chart = this.svg.append("g")
            .attr("transform", `translate(${margins.left},${margins.top})`);
        chart.append("defs")
            .append("clipPath")
            .attr("id", this.clipPathId)
            .append("rect")
            .attr("width", innerWidth)
            .attr("height", innerHeight);
        const plotClip = `url(#${this.clipPathId})`;
        const percentageTicks = Math.min(
            this.clamp(Math.round(percentageAxisSettings.maxTickCount.value), 2, 12),
            Math.max(2, Math.floor(innerHeight / 55))
        );
        const showPercentageGridlines = percentageAxisSettings.showGridlines.value
            && this.formattingSettings.legacyAxesCard.showGridlines.value;
        if (percentageAxisSettings.show.value && showPercentageGridlines) {
            chart.append("g")
                .attr("class", "grid-lines")
                .attr("color", this.visualColor(percentageAxisSettings.gridlineColor.value.value))
                .call(
                    d3.axisLeft(yScale)
                        .ticks(percentageTicks)
                        .tickSize(-innerWidth)
                        .tickFormat(() => "")
                );
        }

        if (showBars) {
            const barPoints = this.sampleBarsForRendering(points, xScale, innerWidth);
            const barWidth = this.getBarWidth(points, xScale, innerWidth);
            chart.append("g")
                .attr("class", "sales-bars")
                .attr("clip-path", plotClip)
                .selectAll("rect")
                .data(barPoints)
                .join("rect")
                .attr("class", "sales-bar")
                .attr("x", point => xScale(point.rank) - barWidth / 2)
                .attr("y", point => valueScale(point.value))
                .attr("width", barWidth)
                .attr("height", point => Math.max(0, innerHeight - valueScale(point.value)))
                .attr("fill", this.isHighContrast
                    ? this.backgroundColor
                    : this.formattingSettings.salesBarsCard.color.value.value)
                .attr("stroke", this.isHighContrast ? this.foregroundColor : "none")
                .attr("stroke-width", this.isHighContrast ? 2 : 0)
                .attr("fill-opacity", 1 - this.clamp(
                    this.formattingSettings.salesBarsCard.transparency.value,
                    0,
                    100
                ) / 100);
            if (hasHighlights) {
                const highlightedBarPoints = this.sampleBarsForRendering(
                    points,
                    xScale,
                    innerWidth,
                    point => point.highlightValue ?? 0
                ).filter(point => (point.highlightValue ?? 0) > 0);
                chart.append("g")
                    .attr("class", "highlight-bars")
                    .attr("clip-path", plotClip)
                    .selectAll("rect")
                    .data(highlightedBarPoints)
                    .join("rect")
                    .attr("class", "highlight-bar")
                    .attr("x", point => xScale(point.rank) - barWidth / 2)
                    .attr("y", point => valueScale(point.highlightValue ?? 0))
                    .attr("width", barWidth)
                    .attr("height", point => Math.max(0, innerHeight - valueScale(point.highlightValue ?? 0)))
                    .attr("fill", highlightColor)
                    .attr("stroke", this.isHighContrast ? this.foregroundColor : "none")
                    .attr("stroke-width", this.isHighContrast ? 2 : 0);
            }
            this.renderSalesLabels(
                chart,
                points,
                xScale,
                valueScale,
                innerWidth,
                innerHeight,
                value => labelValueFormatter.format(value)
            );
        }

        const lineColor = this.visualColor(this.formattingSettings.lineCard.color.value.value);
        const lineGenerator = d3.line<ParetoPoint>()
            .x(point => xScale(point.rank))
            .y(point => yScale(point.cumulativeShare))
            .curve(d3.curveMonotoneX);
        chart.append("path")
            .datum(this.sampleForRendering(points, xScale, innerWidth))
            .attr("class", "pareto-line")
            .attr("clip-path", plotClip)
            .attr("d", lineGenerator)
            .attr("stroke", lineColor)
            .attr("stroke-width", this.clamp(this.formattingSettings.lineCard.width.value, 1, 8));
        if (hasHighlights && points.some(point => point.highlightCumulativeShare !== undefined)) {
            const highlightLineGenerator = d3.line<ParetoPoint>()
                .x(point => xScale(point.rank))
                .y(point => yScale(point.highlightCumulativeShare ?? 0))
                .curve(d3.curveMonotoneX);
            chart.append("path")
                .datum(this.sampleForRendering(points, xScale, innerWidth))
                .attr("class", "highlight-line")
                .attr("clip-path", plotClip)
                .attr("d", highlightLineGenerator)
                .attr("stroke", highlightColor)
                .attr("stroke-width", this.clamp(this.formattingSettings.lineCard.width.value + 0.5, 1.5, 8));
        }

        if (this.formattingSettings.referenceLineCard.show.value) {
            const referenceValue = this.clamp(this.formattingSettings.referenceLineCard.value.value, 0, 1);
            const referenceColor = this.visualColor(this.formattingSettings.referenceLineCard.color.value.value);
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
                .text(formatPercent(referenceValue));
        }

        if (this.formattingSettings.countReferenceLineCard.show.value) {
            const countValue = Math.round(this.formattingSettings.countReferenceLineCard.value.value);
            if (countValue >= 1 && countValue <= points.length) {
                const countColor = this.visualColor(this.formattingSettings.countReferenceLineCard.color.value.value);
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

        const xTickLimit = Math.min(
            this.clamp(Math.round(xAxisSettings.maxTickCount.value), 2, 12),
            Math.max(2, Math.floor(innerWidth / 80))
        );
        const rankTicks = this.selectRankTicks(points.length, xTickLimit);
        if (xAxisSettings.show.value) {
            const xAxis = d3.axisBottom(xScale).tickValues(rankTicks);
            const labelMode = xAxisSettings.labelMode.value?.value ?? "rank";
            const tickGap = Math.max(1, xScale(2) - xScale(1));
            const maxLabelChars = Math.max(4, Math.floor(tickGap / 7));
            const tickFormat = labelMode === "name"
                ? (value: d3.NumberValue) => {
                    const rank = Math.round(Number(value));
                    const point = points[rank - 1];
                    if (!point) {
                        return "";
                    }
                    const name = String(point.name ?? "");
                    return name.length > maxLabelChars
                        ? name.slice(0, maxLabelChars - 1) + "…"
                        : name;
                }
                : (value: d3.NumberValue) => Math.round(Number(value)).toLocaleString();
            const xAxisGroup = chart.append("g")
                .attr("class", "x-axis")
                .attr("transform", `translate(0,${innerHeight})`)
                .call(xAxis.tickFormat(tickFormat));
            this.styleAxis(xAxisGroup, this.visualColor(xAxisSettings.labelColor.value.value), xAxisSettings.labelFont);
            if (xAxisSettings.showTitle.value) {
                chart.append("text")
                    .attr("class", "axis-title x-axis-title")
                    .attr("x", innerWidth / 2)
                    .attr("y", innerHeight + 42)
                    .attr("text-anchor", "middle")
                    .attr("fill", this.visualColor(xAxisSettings.titleColor.value.value))
                    .style("font-family", xAxisSettings.titleFont.fontFamily.value)
                    .style("font-size", `${this.clamp(xAxisSettings.titleFont.fontSize.value, 8, 24)}pt`)
                    .style("font-weight", xAxisSettings.titleFont.bold?.value ? "700" : "400")
                    .style("font-style", xAxisSettings.titleFont.italic?.value ? "italic" : "normal")
                    .text(xAxisSettings.titleText.value || this.t("Text_Ranking"));
            }
        }

        if (percentageAxisSettings.show.value) {
            const percentageAxis = percentagePosition === "left"
                ? d3.axisLeft(yScale)
                : d3.axisRight(yScale);
            const percentageGroup = chart.append("g")
                .attr("class", "y-axis percentage-axis")
                .attr("transform", percentagePosition === "right" ? `translate(${innerWidth},0)` : null)
                .call(percentageAxis.ticks(percentageTicks).tickFormat(value => formatPercent(Number(value))));
            this.styleAxis(
                percentageGroup,
                this.visualColor(percentageAxisSettings.labelColor.value.value),
                percentageAxisSettings.labelFont
            );
            if (percentageAxisSettings.showTitle.value) {
                this.renderVerticalAxisTitle(
                    chart,
                    percentageAxisSettings.titleText.value || this.t("Text_CumulativeShare"),
                    percentagePosition,
                    innerWidth,
                    innerHeight,
                    this.visualColor(percentageAxisSettings.titleColor.value.value),
                    percentageAxisSettings.titleFont,
                    percentagePosition === "left" ? -percentageAxisWidth + 12 : percentageAxisWidth - 12,
                    "percentage-axis-title"
                );
            }
        }

        if (showValueAxis) {
            const valueTicks = Math.min(
                this.clamp(Math.round(valueAxisSettings.maxTickCount.value), 2, 12),
                Math.max(2, Math.floor(innerHeight / 55))
            );
            const valueAxis = valuePosition === "left"
                ? d3.axisLeft(valueScale)
                : d3.axisRight(valueScale);
            const valueGroup = chart.append("g")
                .attr("class", "sales-axis")
                .attr("transform", valuePosition === "right" ? `translate(${innerWidth},0)` : null)
                .call(valueAxis.ticks(valueTicks).tickFormat(value => axisValueFormatter.format(Number(value))));
            this.styleAxis(valueGroup, this.visualColor(valueAxisSettings.labelColor.value.value), valueAxisSettings.labelFont);
            if (valueAxisSettings.showTitle.value) {
                this.renderVerticalAxisTitle(
                    chart,
                    valueAxisSettings.titleText.value || this.t("Text_SecondaryYAxis"),
                    valuePosition,
                    innerWidth,
                    innerHeight,
                    this.visualColor(valueAxisSettings.titleColor.value.value),
                    valueAxisSettings.titleFont,
                    valuePosition === "left" ? -valueAxisWidth + 12 : valueAxisWidth - 12,
                    "value-axis-title"
                );
            }
        }

        this.renderLabels(chart, points, xScale, yScale, innerWidth, innerHeight, formatPercent);
        this.renderHoverLayer(chart, points, xScale, yScale, innerWidth, innerHeight, lineColor);
        this.applySelectionState();
    }

    private sampleBarsForRendering(
        points: ParetoPoint[],
        xScale: d3.ScaleLinear<number, number>,
        innerWidth: number,
        valueAccessor: (point: ParetoPoint) => number = point => point.value
    ): ParetoPoint[] {
        if (points.length <= innerWidth) {
            return points;
        }

        const sampled: ParetoPoint[] = [];
        let currentBucket = -1;
        let bucketPoint: ParetoPoint | undefined;
        for (const point of points) {
            const bucket = Math.floor(xScale(point.rank));
            if (bucket !== currentBucket) {
                if (bucketPoint) {
                    sampled.push(bucketPoint);
                }
                currentBucket = bucket;
                bucketPoint = point;
            } else if (bucketPoint && valueAccessor(point) > valueAccessor(bucketPoint)) {
                bucketPoint = point;
            }
        }
        if (bucketPoint) {
            sampled.push(bucketPoint);
        }
        return sampled;
    }

    private getBarWidth(
        points: ParetoPoint[],
        xScale: d3.ScaleLinear<number, number>,
        innerWidth: number
    ): number {
        const spacing = points.length > 1 ? xScale(2) - xScale(1) : innerWidth;
        const padding = this.clamp(this.formattingSettings.salesBarsCard.innerPadding.value, 0, 90) / 100;
        return this.clamp(spacing * (1 - padding), 1, 28);
    }

    private renderSalesLabels(
        chart: d3.Selection<SVGGElement, unknown, null, undefined>,
        points: ParetoPoint[],
        xScale: d3.ScaleLinear<number, number>,
        valueScale: d3.ScaleLinear<number, number>,
        innerWidth: number,
        innerHeight: number,
        formatValue: (value: number) => string
    ): void {
        const settings = this.formattingSettings.salesLabelsCard;
        if (!settings.show.value || !points.length) {
            return;
        }
        const requestedCount = Math.round(settings.count.value);
        const labelCount = this.clamp(requestedCount, 1, Math.min(20, points.length));
        const indexes = new Set<number>();
        for (let i = 0; i < labelCount; i += 1) {
            indexes.add(Math.round(i * (points.length - 1) / Math.max(1, labelCount - 1)));
        }
        const labelPoints = Array.from(indexes).map(index => points[index]);
        const font = settings.font;
        chart.append("g")
            .attr("class", "sales-value-labels")
            .selectAll("text")
            .data(labelPoints)
            .join("text")
            .attr("x", point => this.clamp(xScale(point.rank), 20, innerWidth - 20))
            .attr("y", point => this.clamp(valueScale(point.value) - 6, 10, innerHeight - 5))
            .attr("text-anchor", "middle")
            .attr("fill", this.visualColor(settings.color.value.value))
            .style("font-family", font.fontFamily.value)
            .style("font-size", `${this.clamp(font.fontSize.value, 8, 22)}pt`)
            .style("font-weight", font.bold?.value ? "700" : "400")
            .style("font-style", font.italic?.value ? "italic" : "normal")
            .text(point => formatValue(point.value));
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
        innerHeight: number,
        formatPercent: (value: number) => string
    ): void {
        if (!this.formattingSettings.dataLabelsCard.show.value) {
            return;
        }

        const settings = this.formattingSettings.dataLabelsCard;
        const requestedCount = Math.round(settings.count.value);
        const labelCount = this.clamp(requestedCount, 1, Math.min(20, points.length));
        const indexes = new Set<number>();
        for (let i = 0; i < labelCount; i += 1) {
            indexes.add(Math.round(i * (points.length - 1) / Math.max(1, labelCount - 1)));
        }

        const labelPoints = Array.from(indexes).map(index => points[index]);
        const font = settings.font;
        const labels = chart.append("g")
            .attr("class", "data-labels")
            .selectAll("text")
            .data(labelPoints)
            .join("text")
            .attr("x", point => this.clamp(xScale(point.rank), 24, innerWidth - 24))
            .attr("y", point => this.clamp(yScale(point.cumulativeShare) - 8, 12, innerHeight - 18))
            .attr("text-anchor", "middle")
            .attr("fill", this.visualColor(settings.color.value.value))
            .style("font-family", font.fontFamily.value)
            .style("font-size", `${this.clamp(font.fontSize.value, 8, 22)}pt`)
            .style("font-weight", font.bold?.value ? "700" : "400")
            .style("font-style", font.italic?.value ? "italic" : "normal");
        labels.append("tspan")
            .attr("x", point => this.clamp(xScale(point.rank), 24, innerWidth - 24))
            .text(point => formatPercent(point.cumulativeShare));
        if (settings.showCurrentShare.value) {
            labels.append("tspan")
                .attr("x", point => this.clamp(xScale(point.rank), 24, innerWidth - 24))
                .attr("dy", "1.15em")
                .attr("class", "current-share-label")
                .text(point => `${this.t("Text_Current")} ${formatPercent(point.currentShare)}`);
        }
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
            .attr("fill", this.isHighContrast ? this.backgroundColor : "#FFFFFF")
            .attr("stroke", lineColor)
            .style("display", "none");

        const overlay = chart.append("rect")
            .attr("class", "hover-overlay")
            .attr("width", innerWidth)
            .attr("height", innerHeight)
            .attr("tabindex", 0)
            .attr("role", "application")
            .attr("aria-roledescription", this.t("Aria_RoleDescription"))
            .attr("aria-label", this.t("Aria_Chart")
                .replace("{category}", this.categoryDisplayName)
                .replace("{count}", points.length.toLocaleString(this.host.locale)));

        const pointFromEvent = (event: PointerEvent | MouseEvent): ParetoPoint => {
            const [mouseX] = d3.pointer(event, overlay.node());
            const rank = this.clamp(Math.round(xScale.invert(mouseX)), 1, points.length);
            return points[rank - 1];
        };
        let keyboardRank = 1;

        const positionHover = (point: ParetoPoint): void => {
            keyboardRank = point.rank;
            hoverLine
                .attr("x1", xScale(point.rank))
                .attr("x2", xScale(point.rank))
                .style("display", null);
            hoverPoint
                .attr("cx", xScale(point.rank))
                .attr("cy", yScale(point.cumulativeShare))
                .style("display", null);
            overlay.attr("aria-label", this.pointAriaLabel(point, points.length));
        };

        const hideHover = (): void => {
            hoverLine.style("display", "none");
            hoverPoint.style("display", "none");
            this.host.tooltipService.hide({ immediately: true, isTouchEvent: false });
        };

        const selectPoint = (point: ParetoPoint, multiSelect: boolean): void => {
            if (!this.allowInteractions) {
                return;
            }
            void this.selectionManager.select(point.selectionId, multiSelect).then(ids => {
                this.updateSelectedKeys(ids as unknown as ISelectionId[]);
            });
        };

        const showContextMenu = (point: ParetoPoint, x: number, y: number): void => {
            if (!this.allowInteractions) {
                return;
            }
            void this.selectionManager.showContextMenu(point.selectionId, { x, y });
        };

        overlay
            .on("pointerenter", (event: PointerEvent) => {
                const point = pointFromEvent(event);
                positionHover(point);
                this.host.tooltipService.show({
                    coordinates: d3.pointer(event, this.target),
                    isTouchEvent: event.pointerType === "touch",
                    dataItems: this.getTooltipItems(point),
                    identities: [point.selectionId]
                });
            })
            .on("pointermove", (event: PointerEvent) => {
                const point = pointFromEvent(event);
                positionHover(point);
                this.host.tooltipService.move({
                    coordinates: d3.pointer(event, this.target),
                    isTouchEvent: event.pointerType === "touch",
                    dataItems: this.getTooltipItems(point),
                    identities: [point.selectionId]
                });
            })
            .on("pointerleave", () => {
                if (document.activeElement !== overlay.node()) {
                    hideHover();
                }
            })
            .on("click", (event: MouseEvent) => {
                selectPoint(pointFromEvent(event), event.ctrlKey || event.metaKey);
            })
            .on("contextmenu", (event: MouseEvent) => {
                event.preventDefault();
                showContextMenu(pointFromEvent(event), event.clientX, event.clientY);
            })
            .on("focus", () => {
                positionHover(points[keyboardRank - 1]);
            })
            .on("blur", hideHover)
            .on("keydown", (event: KeyboardEvent) => {
                let nextRank = keyboardRank;
                if (event.key === "ArrowLeft") {
                    nextRank -= 1;
                } else if (event.key === "ArrowRight") {
                    nextRank += 1;
                } else if (event.key === "Home") {
                    nextRank = 1;
                } else if (event.key === "End") {
                    nextRank = points.length;
                } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectPoint(points[keyboardRank - 1], event.ctrlKey || event.metaKey);
                    return;
                } else if (event.key === "F10" && event.shiftKey) {
                    event.preventDefault();
                    const bounds = overlay.node()?.getBoundingClientRect();
                    showContextMenu(
                        points[keyboardRank - 1],
                        (bounds?.left ?? 0) + xScale(keyboardRank),
                        (bounds?.top ?? 0) + yScale(points[keyboardRank - 1].cumulativeShare)
                    );
                    return;
                } else {
                    return;
                }
                event.preventDefault();
                keyboardRank = this.clamp(nextRank, 1, points.length);
                positionHover(points[keyboardRank - 1]);
            });
    }

    private getTooltipItems(point: ParetoPoint): VisualTooltipDataItem[] {
        const cached = this.tooltipCache.get(point.rank);
        if (cached) {
            return cached;
        }
        const items: VisualTooltipDataItem[] = [
            { displayName: this.categoryDisplayName, value: point.name, header: point.name },
            { displayName: this.measureDisplayName, value: valueFormatter.format(
                point.value,
                point.measureFormat,
                true,
                this.host.locale
            ) },
            { displayName: this.t("Tooltip_Rank"), value: point.rank.toLocaleString(this.host.locale) },
            { displayName: this.t("Tooltip_CurrentShare"), value: this.formatPercentage(point.currentShare, 2) },
            { displayName: this.t("Tooltip_CumulativeShare"), value: this.formatPercentage(point.cumulativeShare, 2) },
            ...point.extraTooltipItems
        ];
        if (point.highlightValue !== undefined) {
            items.splice(2, 0, {
                displayName: this.t("Tooltip_HighlightedValue"),
                value: valueFormatter.format(
                    point.highlightValue,
                    point.measureFormat,
                    true,
                    this.host.locale
                )
            });
        }
        this.tooltipCache.set(point.rank, items);
        return items;
    }

    private pointAriaLabel(point: ParetoPoint, pointCount: number): string {
        return this.t("Aria_Point")
            .replace("{category}", this.categoryDisplayName)
            .replace("{name}", point.name)
            .replace("{rank}", point.rank.toLocaleString(this.host.locale))
            .replace("{measure}", this.measureDisplayName)
            .replace("{value}", valueFormatter.format(point.value, point.measureFormat, true, this.host.locale))
            .replace("{currentShare}", this.formatPercentage(point.currentShare, 2))
            .replace("{cumulativeShare}", this.formatPercentage(point.cumulativeShare, 2))
            .replace("{count}", pointCount.toLocaleString(this.host.locale));
    }

    private updateSelectedKeys(ids: ISelectionId[]): void {
        this.selectedKeys = new Set(ids.map(id => id.getKey()));
        this.applySelectionState();
    }

    private applySelectionState(): void {
        const hasSelection = this.selectedKeys.size > 0;
        const hasHighlights = !this.svg.select(".highlight-bar").empty();
        const baseOpacity = (1 - this.clamp(
            this.formattingSettings.salesBarsCard.transparency.value,
            0,
            100
        ) / 100) * (hasHighlights ? 0.3 : 1);
        this.svg.selectAll<SVGRectElement, ParetoPoint>(".sales-bar")
            .attr("fill-opacity", point => baseOpacity * (
                hasSelection && !this.selectedKeys.has(point.selectionId.getKey()) ? 0.35 : 1
            ))
            .attr("stroke", point => this.selectedKeys.has(point.selectionId.getKey())
                ? this.foregroundSelectedColor
                : (this.isHighContrast ? this.foregroundColor : "none"))
            .attr("stroke-width", point => this.selectedKeys.has(point.selectionId.getKey())
                ? 2.5
                : (this.isHighContrast ? 2 : 0));
        this.svg.selectAll<SVGPathElement, unknown>(".pareto-line")
            .attr("opacity", hasSelection ? 0.65 : 1);
    }

    private applyThemeDefaults(dataView: powerbi.DataView | undefined): void {
        if (this.isHighContrast) {
            this.target.style.color = this.foregroundColor;
            this.target.style.backgroundColor = this.backgroundColor;
            return;
        }
        this.target.style.removeProperty("color");
        this.target.style.removeProperty("background-color");
        const objects = dataView?.metadata.objects;
        if (objects?.line?.color === undefined) {
            this.formattingSettings.lineCard.color.value.value = this.host.colorPalette
                .getColor("pareto-cumulative-line").value;
        }
        if (objects?.salesBars?.color === undefined) {
            this.formattingSettings.salesBarsCard.color.value.value = this.host.colorPalette
                .getColor("pareto-value-bars").value;
        }
    }

    private visualColor(configuredColor: string): string {
        return this.isHighContrast ? this.foregroundColor : configuredColor;
    }

    private refreshHostColors(): void {
        const palette = this.host.colorPalette;
        this.isHighContrast = palette.isHighContrast;
        this.foregroundColor = palette.foreground.value;
        this.backgroundColor = palette.background.value;
        this.foregroundSelectedColor = palette.foregroundSelected.value;
    }

    private updateDisplayNames(dataView: powerbi.DataView): void {
        const tableCategory = dataView.table?.columns.find(column => column.roles?.category);
        const tableMeasure = dataView.table?.columns.find(column => column.roles?.measure);
        const categoricalCategory = dataView.categorical?.categories?.[0]?.source;
        const categoricalMeasure = dataView.categorical?.values
            ?.find(column => column.source.roles?.measure)?.source;
        this.categoryDisplayName = tableCategory?.displayName
            || categoricalCategory?.displayName
            || this.t("Role_Category");
        this.measureDisplayName = tableMeasure?.displayName
            || categoricalMeasure?.displayName
            || this.t("Role_Measure");
    }

    private applyLocalizedTitleDefaults(dataView: powerbi.DataView): void {
        const objects = dataView.metadata.objects;
        if (objects?.xAxis?.titleText === undefined) {
            const labelMode = this.formattingSettings.xAxisCard.labelMode.value?.value ?? "rank";
            this.formattingSettings.xAxisCard.titleText.value = this.t(
                labelMode === "name" ? "Text_Category" : "Text_Ranking"
            );
        }
        if (objects?.valueAxis?.titleText === undefined) {
            this.formattingSettings.valueAxisCard.titleText.value = this.t("Text_SecondaryYAxis");
        }
        if (objects?.percentageAxis?.titleText === undefined) {
            this.formattingSettings.percentageAxisCard.titleText.value = this.t("Text_CumulativeShare");
        }
    }

    private t(key: string): string {
        return this.localizationManager.getDisplayName(key);
    }

    private applyExplicitTitleSettings(dataView: powerbi.DataView | undefined): void {
        const objects = dataView?.metadata.objects;
        const bindings: Array<[
            powerbi.DataViewObject | undefined,
            { value: boolean }
        ]> = [
            [objects?.xAxis, this.formattingSettings.xAxisCard.showTitle],
            [objects?.valueAxis, this.formattingSettings.valueAxisCard.showTitle],
            [objects?.percentageAxis, this.formattingSettings.percentageAxisCard.showTitle]
        ];
        for (const [axisObject, setting] of bindings) {
            if (typeof axisObject?.showTitle === "boolean") {
                setting.value = axisObject.showTitle;
            }
        }
    }

    private applyLegacySettings(dataView: powerbi.DataView | undefined): void {
        const objects = dataView?.metadata.objects;
        if (!objects?.axes || objects.xAxis || objects.percentageAxis || objects.valueAxis) {
            return;
        }
        const legacyFontSize = Number(objects.axes.fontSize);
        if (Number.isFinite(legacyFontSize)) {
            this.formattingSettings.xAxisCard.labelFont.fontSize.value = legacyFontSize;
            this.formattingSettings.valueAxisCard.labelFont.fontSize.value = legacyFontSize;
            this.formattingSettings.percentageAxisCard.labelFont.fontSize.value = legacyFontSize;
        }
        const legacyGridlines = objects.axes.showGridlines;
        if (typeof legacyGridlines === "boolean") {
            this.formattingSettings.percentageAxisCard.showGridlines.value = legacyGridlines;
        }
    }

    private createValueFormatter(
        format: string | undefined,
        maximum: number,
        configuredUnits: number,
        precision: number
    ): valueFormatter.IValueFormatter {
        const displayUnits = configuredUnits === 0
            ? this.autoDisplayUnits(maximum)
            : configuredUnits;
        const formatterValue = displayUnits === 1 ? 0 : displayUnits;
        return valueFormatter.create({
            format,
            value: formatterValue,
            value2: formatterValue,
            precision: this.clamp(Math.round(precision), 0, 4),
            cultureSelector: this.host.locale
        });
    }

    private autoDisplayUnits(maximum: number): number {
        if (maximum >= 1_000_000_000_000) {
            return 1_000_000_000_000;
        }
        if (maximum >= 1_000_000_000) {
            return 1_000_000_000;
        }
        if (maximum >= 1_000_000) {
            return 1_000_000;
        }
        if (maximum >= 1_000) {
            return 1_000;
        }
        return 1;
    }

    private formatPercentage(value: number, decimals: number): string {
        const safeDecimals = this.clamp(Math.round(decimals), 0, 4);
        const formatted = valueFormatter.format(
            value,
            safeDecimals === 0 ? "0%" : `0.${"0".repeat(safeDecimals)}%`,
            true,
            this.host.locale
        );
        if (value > 0 && safeDecimals > 0 && Number(formatted.replace(/[^0-9.-]/g, "")) === 0) {
            return `<${(100 / Math.pow(10, safeDecimals)).toFixed(safeDecimals)}%`;
        }
        return formatted;
    }

    private selectRankTicks(pointCount: number, maximumTicks: number): number[] {
        if (pointCount <= maximumTicks) {
            return d3.range(1, pointCount + 1);
        }
        const ticks = new Set<number>();
        for (let index = 0; index < maximumTicks; index += 1) {
            ticks.add(Math.round(1 + index * (pointCount - 1) / Math.max(1, maximumTicks - 1)));
        }
        return Array.from(ticks);
    }

    private styleAxis(
        axis: d3.Selection<SVGGElement, unknown, null, undefined>,
        color: string,
        font: {
            fontFamily: { value: string };
            fontSize: { value: number };
            bold?: { value: boolean };
            italic?: { value: boolean };
        }
    ): void {
        axis.attr("color", color);
        axis.selectAll<SVGPathElement | SVGLineElement, unknown>("path, line")
            .attr("stroke", this.visualColor("#C8CDD2"));
        axis.selectAll<SVGTextElement, unknown>("text")
            .style("font-family", font.fontFamily.value)
            .style("font-size", `${this.clamp(font.fontSize.value, 8, 24)}pt`)
            .style("font-weight", font.bold?.value ? "700" : "400")
            .style("font-style", font.italic?.value ? "italic" : "normal");
    }

    private renderVerticalAxisTitle(
        chart: d3.Selection<SVGGElement, unknown, null, undefined>,
        text: string,
        position: "left" | "right",
        innerWidth: number,
        innerHeight: number,
        color: string,
        font: {
            fontFamily: { value: string };
            fontSize: { value: number };
            bold?: { value: boolean };
            italic?: { value: boolean };
        },
        offset: number,
        className: string
    ): void {
        const x = position === "left" ? offset : innerWidth + offset;
        chart.append("text")
            .attr("class", `axis-title ${className}`)
            .attr("transform", `translate(${x},${innerHeight / 2}) rotate(${position === "left" ? -90 : 90})`)
            .attr("text-anchor", "middle")
            .attr("fill", color)
            .style("font-family", font.fontFamily.value)
            .style("font-size", `${this.clamp(font.fontSize.value, 8, 24)}pt`)
            .style("font-weight", font.bold?.value ? "700" : "400")
            .style("font-style", font.italic?.value ? "italic" : "normal")
            .text(text);
    }

    private hideMessages(): void {
        this.emptyState.style.display = "none";
        this.warning.style.display = "none";
    }

    private showEmpty(message: string): void {
        this.emptyState.textContent = message;
        if (this.isHighContrast) {
            this.emptyState.style.color = this.foregroundColor;
            this.emptyState.style.backgroundColor = this.backgroundColor;
        } else {
            this.emptyState.style.removeProperty("color");
            this.emptyState.style.removeProperty("background-color");
        }
        this.emptyState.style.display = "flex";
    }

    private showWarning(message: string): void {
        this.warning.textContent = message;
        if (this.isHighContrast) {
            this.warning.style.color = this.foregroundColor;
            this.warning.style.backgroundColor = this.backgroundColor;
            this.warning.style.border = `1px solid ${this.foregroundColor}`;
        } else {
            this.warning.style.removeProperty("color");
            this.warning.style.removeProperty("background-color");
            this.warning.style.removeProperty("border");
        }
        this.warning.style.display = "block";
    }

    private clamp(value: number, minimum: number, maximum: number): number {
        return Math.max(minimum, Math.min(maximum, value));
    }
}
