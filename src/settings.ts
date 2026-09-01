"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

class LineCardSettings extends FormattingSettingsCard {
    public color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "颜色",
        value: { value: "#0097C6" }
    });

    public width = new formattingSettings.NumUpDown({
        name: "width",
        displayName: "线宽",
        value: 2.5
    });

    public name = "line";
    public displayName = "曲线";
    public slices: FormattingSettingsSlice[] = [this.color, this.width];
}

class AxesCardSettings extends FormattingSettingsCard {
    public showGridlines = new formattingSettings.ToggleSwitch({
        name: "showGridlines",
        displayName: "显示网格线",
        value: true
    });

    public fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "字号",
        value: 11
    });

    public name = "axes";
    public displayName = "坐标轴";
    public slices: FormattingSettingsSlice[] = [this.showGridlines, this.fontSize];
}

class DataLabelsCardSettings extends FormattingSettingsCard {
    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "显示",
        value: true
    });

    public count = new formattingSettings.NumUpDown({
        name: "count",
        displayName: "标签数量",
        value: 8
    });

    public fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "字号",
        value: 10
    });

    public name = "dataLabels";
    public displayName = "数据标签";
    public slices: FormattingSettingsSlice[] = [this.show, this.count, this.fontSize];
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
        value: 0.8
    });

    public color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "颜色",
        value: { value: "#A4262C" }
    });

    public name = "referenceLine";
    public displayName = "占比参考线";
    public slices: FormattingSettingsSlice[] = [this.show, this.value, this.color];
}

class CountReferenceLineCardSettings extends FormattingSettingsCard {
    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "显示",
        value: false
    });

    public value = new formattingSettings.NumUpDown({
        name: "value",
        displayName: "门店数量",
        value: 1000
    });

    public color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "颜色",
        value: { value: "#E66C37" }
    });

    public name = "countReferenceLine";
    public displayName = "数量参考线";
    public slices: FormattingSettingsSlice[] = [this.show, this.value, this.color];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    public lineCard = new LineCardSettings();
    public axesCard = new AxesCardSettings();
    public dataLabelsCard = new DataLabelsCardSettings();
    public referenceLineCard = new ReferenceLineCardSettings();
    public countReferenceLineCard = new CountReferenceLineCardSettings();

    public cards = [
        this.lineCard,
        this.axesCard,
        this.dataLabelsCard,
        this.referenceLineCard,
        this.countReferenceLineCard
    ];
}
