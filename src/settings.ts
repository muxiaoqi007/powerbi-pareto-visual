"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsCompositeCard = formattingSettings.CompositeCard;
import FormattingSettingsGroup = formattingSettings.Group;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

interface LocalizableFormattingEntity {
    displayName?: string;
    displayNameKey?: string;
    slices?: LocalizableFormattingEntity[];
    groups?: LocalizableFormattingEntity[];
    topLevelSlice?: LocalizableFormattingEntity;
}

const formattingDisplayNameKeys: Record<string, string> = {
    "帕累托曲线": "Card_ParetoLine",
    "X 轴": "Card_XAxis",
    "副 Y 轴": "Card_ValueAxis",
    "累计占比轴": "Card_PercentageAxis",
    "累计占比标签": "Card_DataLabels",
    "销售额柱子": "Card_SalesBars",
    "销售额标签": "Card_SalesLabels",
    "旧版坐标轴": "Card_LegacyAxes",
    "占比参考线": "Card_ReferenceLine",
    "数量参考线": "Card_CountReferenceLine",
    "字体": "Format_Font",
    "颜色": "Format_Color",
    "线宽": "Format_LineWidth",
    "显示": "Format_Show",
    "最大刻度数": "Format_MaxTickCount",
    "标签颜色": "Format_LabelColor",
    "显示标题": "Format_ShowTitle",
    "标题文本": "Format_TitleText",
    "标题颜色": "Format_TitleColor",
    "标签": "Format_Labels",
    "标题": "Format_Title",
    "位置": "Format_Position",
    "显示单位": "Format_DisplayUnits",
    "小数位数": "Format_DecimalPlaces",
    "范围": "Format_Range",
    "最小值": "Format_Minimum",
    "最大值": "Format_Maximum",
    "选项": "Format_Options",
    "标签类型": "Format_LabelType",
    "显示网格线": "Format_ShowGridlines",
    "网格线颜色": "Format_GridlineColor",
    "显示当前值占比": "Format_ShowCurrentShare",
    "标签数量": "Format_LabelCount",
    "透明度": "Format_Transparency",
    "内部间距": "Format_InnerPadding",
    "着色模式": "Format_ColorMode",
    "A 类累计上限 (%)": "Format_ClassAThreshold",
    "B 类累计上限 (%)": "Format_ClassBThreshold",
    "A 类颜色": "Format_ColorA",
    "B 类颜色": "Format_ColorB",
    "C 类颜色": "Format_ColorC",
    "累计占比": "Format_CumulativeShare",
    "分类数量": "Format_CategoryCount"
};

function assignLocalizationKeys(entity: LocalizableFormattingEntity): void {
    if (entity.displayName) {
        entity.displayNameKey = formattingDisplayNameKeys[entity.displayName];
    }
    entity.slices?.forEach(assignLocalizationKeys);
    entity.groups?.forEach(assignLocalizationKeys);
    if (entity.topLevelSlice) {
        assignLocalizationKeys(entity.topLevelSlice);
    }
}

function numberOptions(minimum: number, maximum: number): powerbi.visuals.NumUpDownFormat {
    return {
        minValue: { type: powerbi.visuals.ValidatorType.Min, value: minimum },
        maxValue: { type: powerbi.visuals.ValidatorType.Max, value: maximum }
    };
}

function createFont(
    name: string,
    familyProperty: string,
    sizeProperty: string,
    boldProperty: string,
    italicProperty: string,
    size: number
): formattingSettings.FontControl {
    return new formattingSettings.FontControl({
        name,
        displayName: "字体",
        fontFamily: new formattingSettings.FontPicker({
            name: familyProperty,
            value: "Segoe UI"
        }),
        fontSize: new formattingSettings.NumUpDown({
            name: sizeProperty,
            value: size,
            options: numberOptions(8, 24)
        }),
        bold: new formattingSettings.ToggleSwitch({
            name: boldProperty,
            value: false
        }),
        italic: new formattingSettings.ToggleSwitch({
            name: italicProperty,
            value: false
        })
    });
}

class LineCardSettings extends FormattingSettingsCard {
    public color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "颜色",
        value: { value: "#0097C6" }
    });

    public width = new formattingSettings.NumUpDown({
        name: "width",
        displayName: "线宽",
        value: 2.5,
        options: numberOptions(1, 8)
    });

    public name = "line";
    public displayName = "帕累托曲线";
    public slices: FormattingSettingsSlice[] = [this.color, this.width];
}

class XAxisCardSettings extends FormattingSettingsCompositeCard {
    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "显示",
        value: true
    });

    public labelMode = new formattingSettings.ItemDropdown({
        name: "labelMode",
        displayName: "标签类型",
        items: [
            { displayName: "排名", value: "rank" },
            { displayName: "分类名称", value: "name" }
        ],
        value: { displayName: "排名", value: "rank" }
    });

    public maxTickCount = new formattingSettings.NumUpDown({
        name: "maxTickCount",
        displayName: "最大刻度数",
        value: 8,
        options: numberOptions(2, 12)
    });

    public labelColor = new formattingSettings.ColorPicker({
        name: "labelColor",
        displayName: "标签颜色",
        value: { value: "#6B6B6B" }
    });

    public labelFont = createFont(
        "labelFont",
        "labelFontFamily",
        "labelFontSize",
        "labelBold",
        "labelItalic",
        9
    );

    public showTitle = new formattingSettings.ToggleSwitch({
        name: "showTitle",
        displayName: "显示标题",
        value: true
    });

    public titleText = new formattingSettings.TextInput({
        name: "titleText",
        displayName: "标题文本",
        value: "排名",
        placeholder: "排名"
    });

    public titleColor = new formattingSettings.ColorPicker({
        name: "titleColor",
        displayName: "标题颜色",
        value: { value: "#6B6B6B" }
    });

    public titleFont = createFont(
        "titleFont",
        "titleFontFamily",
        "titleFontSize",
        "titleBold",
        "titleItalic",
        9
    );

    public name = "xAxis";
    public displayName = "X 轴";
    public topLevelSlice = this.show;
    public optionGroup = new FormattingSettingsGroup({
        name: "xAxisOptions",
        displayName: "选项",
        slices: [this.labelMode, this.maxTickCount]
    });
    public labelGroup = new FormattingSettingsGroup({
        name: "xAxisLabels",
        displayName: "标签",
        slices: [this.labelColor, this.labelFont]
    });
    public titleGroup = new FormattingSettingsGroup({
        name: "xAxisTitle",
        displayName: "标题",
        topLevelSlice: this.showTitle,
        slices: [this.titleText, this.titleColor, this.titleFont]
    });
    public groups = [this.optionGroup, this.labelGroup, this.titleGroup];

    public onPreProcess(): void {
        this.optionGroup.visible = this.show.value;
        this.labelGroup.visible = this.show.value;
        this.titleGroup.visible = this.show.value;
        this.titleText.visible = this.showTitle.value;
        this.titleColor.visible = this.showTitle.value;
        this.titleFont.visible = this.showTitle.value;
    }
}

class ValueAxisCardSettings extends FormattingSettingsCompositeCard {
    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "显示",
        value: true
    });

    public position = new formattingSettings.AutoDropdown({
        name: "position",
        displayName: "位置",
        value: "right"
    });

    public displayUnits = new formattingSettings.AutoDropdown({
        name: "displayUnits",
        displayName: "显示单位",
        value: 0,
        filterValues: [0, 1, 1000, 1000000, 1000000000, 1000000000000]
    });

    public decimalPlaces = new formattingSettings.NumUpDown({
        name: "decimalPlaces",
        displayName: "小数位数",
        value: 0,
        options: numberOptions(0, 4)
    });

    public rangeMode = new formattingSettings.AutoDropdown({
        name: "rangeMode",
        displayName: "范围",
        value: "auto"
    });

    public start = new formattingSettings.NumUpDown({
        name: "start",
        displayName: "最小值",
        value: 0
    });

    public end = new formattingSettings.NumUpDown({
        name: "end",
        displayName: "最大值",
        value: 100
    });

    public maxTickCount = new formattingSettings.NumUpDown({
        name: "maxTickCount",
        displayName: "最大刻度数",
        value: 6,
        options: numberOptions(2, 12)
    });

    public labelColor = new formattingSettings.ColorPicker({
        name: "labelColor",
        displayName: "标签颜色",
        value: { value: "#6B6B6B" }
    });

    public labelFont = createFont(
        "labelFont",
        "labelFontFamily",
        "labelFontSize",
        "labelBold",
        "labelItalic",
        9
    );

    public showTitle = new formattingSettings.ToggleSwitch({
        name: "showTitle",
        displayName: "显示标题",
        value: true
    });

    public titleText = new formattingSettings.TextInput({
        name: "titleText",
        displayName: "标题文本",
        value: "副 Y 轴",
        placeholder: "副 Y 轴"
    });

    public titleColor = new formattingSettings.ColorPicker({
        name: "titleColor",
        displayName: "标题颜色",
        value: { value: "#6B6B6B" }
    });

    public titleFont = createFont(
        "titleFont",
        "titleFontFamily",
        "titleFontSize",
        "titleBold",
        "titleItalic",
        9
    );

    public name = "valueAxis";
    public displayName = "副 Y 轴";
    public topLevelSlice = this.show;
    public optionGroup = new FormattingSettingsGroup({
        name: "valueAxisOptions",
        displayName: "选项",
        slices: [
            this.position,
            this.displayUnits,
            this.decimalPlaces,
            this.rangeMode,
            this.start,
            this.end,
            this.maxTickCount
        ]
    });
    public labelGroup = new FormattingSettingsGroup({
        name: "valueAxisLabels",
        displayName: "标签",
        slices: [this.labelColor, this.labelFont]
    });
    public titleGroup = new FormattingSettingsGroup({
        name: "valueAxisTitle",
        displayName: "标题",
        topLevelSlice: this.showTitle,
        slices: [this.titleText, this.titleColor, this.titleFont]
    });
    public groups = [this.optionGroup, this.labelGroup, this.titleGroup];

    public onPreProcess(): void {
        this.optionGroup.visible = this.show.value;
        this.labelGroup.visible = this.show.value;
        this.titleGroup.visible = this.show.value;
        const customRange = this.rangeMode.value === "custom";
        this.start.visible = customRange;
        this.end.visible = customRange;
        this.titleText.visible = this.showTitle.value;
        this.titleColor.visible = this.showTitle.value;
        this.titleFont.visible = this.showTitle.value;
    }
}

class PercentageAxisCardSettings extends FormattingSettingsCompositeCard {
    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "显示",
        value: true
    });

    public position = new formattingSettings.AutoDropdown({
        name: "position",
        displayName: "位置",
        value: "left"
    });

    public decimalPlaces = new formattingSettings.NumUpDown({
        name: "decimalPlaces",
        displayName: "小数位数",
        value: 0,
        options: numberOptions(0, 4)
    });

    public maxTickCount = new formattingSettings.NumUpDown({
        name: "maxTickCount",
        displayName: "最大刻度数",
        value: 6,
        options: numberOptions(2, 12)
    });

    public showGridlines = new formattingSettings.ToggleSwitch({
        name: "showGridlines",
        displayName: "显示网格线",
        value: true
    });

    public gridlineColor = new formattingSettings.ColorPicker({
        name: "gridlineColor",
        displayName: "网格线颜色",
        value: { value: "#E6E9ED" }
    });

    public labelColor = new formattingSettings.ColorPicker({
        name: "labelColor",
        displayName: "标签颜色",
        value: { value: "#6B6B6B" }
    });

    public labelFont = createFont(
        "labelFont",
        "labelFontFamily",
        "labelFontSize",
        "labelBold",
        "labelItalic",
        9
    );

    public showTitle = new formattingSettings.ToggleSwitch({
        name: "showTitle",
        displayName: "显示标题",
        value: true
    });

    public titleText = new formattingSettings.TextInput({
        name: "titleText",
        displayName: "标题文本",
        value: "累计占比",
        placeholder: "累计占比"
    });

    public titleColor = new formattingSettings.ColorPicker({
        name: "titleColor",
        displayName: "标题颜色",
        value: { value: "#6B6B6B" }
    });

    public titleFont = createFont(
        "titleFont",
        "titleFontFamily",
        "titleFontSize",
        "titleBold",
        "titleItalic",
        9
    );

    public name = "percentageAxis";
    public displayName = "累计占比轴";
    public topLevelSlice = this.show;
    public optionGroup = new FormattingSettingsGroup({
        name: "percentageAxisOptions",
        displayName: "选项",
        slices: [
            this.position,
            this.decimalPlaces,
            this.maxTickCount,
            this.showGridlines,
            this.gridlineColor
        ]
    });
    public labelGroup = new FormattingSettingsGroup({
        name: "percentageAxisLabels",
        displayName: "标签",
        slices: [this.labelColor, this.labelFont]
    });
    public titleGroup = new FormattingSettingsGroup({
        name: "percentageAxisTitle",
        displayName: "标题",
        topLevelSlice: this.showTitle,
        slices: [this.titleText, this.titleColor, this.titleFont]
    });
    public groups = [this.optionGroup, this.labelGroup, this.titleGroup];

    public onPreProcess(): void {
        this.optionGroup.visible = this.show.value;
        this.labelGroup.visible = this.show.value;
        this.titleGroup.visible = this.show.value;
        this.gridlineColor.visible = this.showGridlines.value;
        this.titleText.visible = this.showTitle.value;
        this.titleColor.visible = this.showTitle.value;
        this.titleFont.visible = this.showTitle.value;
    }
}

class DataLabelsCardSettings extends FormattingSettingsCard {
    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "显示",
        value: true
    });

    public showCurrentShare = new formattingSettings.ToggleSwitch({
        name: "showCurrentShare",
        displayName: "显示当前值占比",
        value: true
    });

    public count = new formattingSettings.NumUpDown({
        name: "count",
        displayName: "标签数量",
        value: 8,
        options: numberOptions(1, 20)
    });

    public color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "颜色",
        value: { value: "#5E5E5E" }
    });

    public font = createFont("font", "fontFamily", "fontSize", "bold", "italic", 10);

    public name = "dataLabels";
    public displayName = "累计占比标签";
    public topLevelSlice = this.show;
    public slices: FormattingSettingsSlice[] = [this.showCurrentShare, this.count, this.color, this.font];

    public onPreProcess(): void {
        this.slices.forEach(slice => slice.visible = this.show.value);
    }
}

class SalesBarsCardSettings extends FormattingSettingsCard {
    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "显示",
        value: true
    });

    public color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "颜色",
        value: { value: "#7B61FF" }
    });

    public colorMode = new formattingSettings.ItemDropdown({
        name: "colorMode",
        displayName: "着色模式",
        items: [
            { displayName: "单一颜色", value: "single" },
            { displayName: "按累计占比 (ABC)", value: "abc" }
        ],
        value: { displayName: "单一颜色", value: "single" }
    });

    public classAThreshold = new formattingSettings.NumUpDown({
        name: "classAThreshold",
        displayName: "A 类累计上限 (%)",
        value: 80,
        options: numberOptions(1, 99)
    });

    public classBThreshold = new formattingSettings.NumUpDown({
        name: "classBThreshold",
        displayName: "B 类累计上限 (%)",
        value: 95,
        options: numberOptions(1, 100)
    });

    public colorA = new formattingSettings.ColorPicker({
        name: "colorA",
        displayName: "A 类颜色",
        value: { value: "#D64550" }
    });

    public colorB = new formattingSettings.ColorPicker({
        name: "colorB",
        displayName: "B 类颜色",
        value: { value: "#E8A33D" }
    });

    public colorC = new formattingSettings.ColorPicker({
        name: "colorC",
        displayName: "C 类颜色",
        value: { value: "#8A9BA8" }
    });

    public transparency = new formattingSettings.NumUpDown({
        name: "transparency",
        displayName: "透明度",
        value: 28,
        options: numberOptions(0, 100)
    });

    public innerPadding = new formattingSettings.NumUpDown({
        name: "innerPadding",
        displayName: "内部间距",
        value: 20,
        options: numberOptions(0, 90)
    });

    public name = "salesBars";
    public displayName = "销售额柱子";
    public topLevelSlice = this.show;
    public slices: FormattingSettingsSlice[] = [
        this.color,
        this.colorMode,
        this.classAThreshold,
        this.classBThreshold,
        this.colorA,
        this.colorB,
        this.colorC,
        this.transparency,
        this.innerPadding
    ];

    public onPreProcess(): void {
        this.slices.forEach(slice => slice.visible = this.show.value);
        const abcMode = this.colorMode.value?.value === "abc";
        this.classAThreshold.visible = this.show.value && abcMode;
        this.classBThreshold.visible = this.show.value && abcMode;
        this.colorA.visible = this.show.value && abcMode;
        this.colorB.visible = this.show.value && abcMode;
        this.colorC.visible = this.show.value && abcMode;
    }
}

class SalesLabelsCardSettings extends FormattingSettingsCard {
    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "显示",
        value: false
    });

    public color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "颜色",
        value: { value: "#383838" }
    });

    public count = new formattingSettings.NumUpDown({
        name: "count",
        displayName: "标签数量",
        value: 8,
        options: numberOptions(1, 20)
    });

    public displayUnits = new formattingSettings.AutoDropdown({
        name: "displayUnits",
        displayName: "显示单位",
        value: 0,
        filterValues: [0, 1, 1000, 1000000, 1000000000, 1000000000000]
    });

    public decimalPlaces = new formattingSettings.NumUpDown({
        name: "decimalPlaces",
        displayName: "小数位数",
        value: 0,
        options: numberOptions(0, 4)
    });

    public font = createFont("font", "fontFamily", "fontSize", "bold", "italic", 10);

    public name = "salesLabels";
    public displayName = "销售额标签";
    public topLevelSlice = this.show;
    public slices: FormattingSettingsSlice[] = [
        this.color,
        this.count,
        this.displayUnits,
        this.decimalPlaces,
        this.font
    ];

    public onPreProcess(): void {
        this.slices.forEach(slice => slice.visible = this.show.value);
    }
}

class LegacyAxesCardSettings extends FormattingSettingsCard {
    public showGridlines = new formattingSettings.ToggleSwitch({
        name: "showGridlines",
        value: true
    });

    public fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        value: 11
    });

    public name = "axes";
    public displayName = "旧版坐标轴";
    public visible = false;
    public slices: FormattingSettingsSlice[] = [this.showGridlines, this.fontSize];
}

class ReferenceLineCardSettings extends FormattingSettingsCard {
    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "显示",
        value: false
    });

    public value = new formattingSettings.NumUpDown({
        name: "value",
        displayName: "累计占比",
        value: 0.8,
        options: numberOptions(0, 1)
    });

    public color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "颜色",
        value: { value: "#A4262C" }
    });

    public name = "referenceLine";
    public displayName = "占比参考线";
    public topLevelSlice = this.show;
    public slices: FormattingSettingsSlice[] = [this.value, this.color];

    public onPreProcess(): void {
        this.slices.forEach(slice => slice.visible = this.show.value);
    }
}

class CountReferenceLineCardSettings extends FormattingSettingsCard {
    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "显示",
        value: false
    });

    public value = new formattingSettings.NumUpDown({
        name: "value",
        displayName: "分类数量",
        value: 1000,
        options: numberOptions(1, 30000)
    });

    public color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "颜色",
        value: { value: "#E66C37" }
    });

    public name = "countReferenceLine";
    public displayName = "数量参考线";
    public topLevelSlice = this.show;
    public slices: FormattingSettingsSlice[] = [this.value, this.color];

    public onPreProcess(): void {
        this.slices.forEach(slice => slice.visible = this.show.value);
    }
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    public lineCard = new LineCardSettings();
    public xAxisCard = new XAxisCardSettings();
    public valueAxisCard = new ValueAxisCardSettings();
    public percentageAxisCard = new PercentageAxisCardSettings();
    public dataLabelsCard = new DataLabelsCardSettings();
    public salesBarsCard = new SalesBarsCardSettings();
    public salesLabelsCard = new SalesLabelsCardSettings();
    public legacyAxesCard = new LegacyAxesCardSettings();
    public referenceLineCard = new ReferenceLineCardSettings();
    public countReferenceLineCard = new CountReferenceLineCardSettings();

    public cards = [
        this.lineCard,
        this.xAxisCard,
        this.valueAxisCard,
        this.percentageAxisCard,
        this.salesBarsCard,
        this.salesLabelsCard,
        this.dataLabelsCard,
        this.referenceLineCard,
        this.countReferenceLineCard,
        this.legacyAxesCard
    ];

    constructor() {
        super();
        this.cards.forEach(card => assignLocalizationKeys(card));
    }
}
