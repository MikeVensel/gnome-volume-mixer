import Gio from "gi://Gio";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Slider from "resource:///org/gnome/shell/ui/slider.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import Gvc from "gi://Gvc";
import * as Volume from "resource:///org/gnome/shell/ui/status/volume.js";

class SinkSliderItem extends PopupMenu.PopupBaseMenuItem {
  static {
    GObject.registerClass(this);
  }

  private _slider: Slider.Slider;
  public _sink: Gvc.MixerSink;
  private _control: Gvc.MixerControl;
  private _volumeChangedId: number;

  constructor(sink: Gvc.MixerSink, control: Gvc.MixerControl) {
    super({ activate: false });
    this.x_expand = true;

    this._sink = sink;
    this._control = control;

    const label = new St.Label({
      text: sink.get_description() ?? sink.get_name(),
      y_align: 1, // Clutter.ActorAlign.CENTER
      x_expand: false,
      style: "min-width: 10em;",
    });
    this.add_child(label);

    const maxVol = control.get_vol_max_norm();
    this._slider = new Slider.Slider(sink.get_volume() / maxVol);
    this._slider.x_expand = true;
    this._slider.style = "min-width: 12em;";
    this.add_child(this._slider);

    // When user moves the slider, update the sink volume
    this._slider.connect("notify::value", () => {
      this._sink.set_volume(Math.round(this._slider.value * maxVol));
      this._sink.push_volume();
    });

    // Keep slider in sync if volume changes externally
    this._volumeChangedId = this._sink.connect("notify::volume", () => {
      this._slider.value = this._sink.get_volume() / maxVol;
    });
  }

  destroy(): void {
    this._sink.disconnect(this._volumeChangedId);
    super.destroy();
  }
}

class Indicator extends PanelMenu.Button {
  static {
    // Register the GObject type so GNOME Shell recognises it
    GObject.registerClass(this);
  }

  private _volumeMixerControl: Gvc.MixerControl;
  private _settings: Gio.Settings;
  private _menu: PopupMenu.PopupMenu;
  private _sinkItems = new Map<number, SinkSliderItem>();
  private _streamAddedId: number;
  private _streamRemovedId: number;
  private _settingsChangedId: number;

  constructor(settings: Gio.Settings) {
    super(0.0, "Volume Mixer Indicator", false);
    this._settings = settings;
    this._menu = this.menu as PopupMenu.PopupMenu;

    // Icon shown in the panel
    const icon = new St.Icon({
      icon_name: "audio-volume-high-symbolic",
      style_class: "system-status-icon",
    });
    this.add_child(icon);

    this._volumeMixerControl = Volume.getMixerControl();

    // React to sinks being added/removed dynamically
    this._streamAddedId = this._volumeMixerControl.connect(
      "stream-added",
      (ctrl, id) => {
        const stream = ctrl.lookup_stream_id(id);
        if (stream instanceof Gvc.MixerSink) {
          this._addSinkIfVisible(stream, ctrl);
        }
      },
    );

    this._streamRemovedId = this._volumeMixerControl.connect(
      "stream-removed",
      (_ctrl, id) => {
        this._removeSinkById(id);
      },
    );

    this._settingsChangedId = this._settings.connect(
      "changed::excluded-sinks",
      () => {
        this._rebuildSinkItems();
      },
    );

    this._rebuildSinkItems();
  }

  destroy(): void {
    this._volumeMixerControl.disconnect(this._streamAddedId);
    this._volumeMixerControl.disconnect(this._streamRemovedId);
    this._settings.disconnect(this._settingsChangedId);
    super.destroy();
  }

  private _isSinkVisible(sink: Gvc.MixerSink): boolean {
    const excludedSinks = new Set(
      this._settings
        .get_strv("excluded-sinks")
        .map((name) => name.trim())
        .filter((name) => name.length > 0),
    );

    const sinkName = sink.get_name()?.trim() ?? "";
    const sinkDescription = sink.get_description()?.trim() ?? "";

    return !(excludedSinks.has(sinkName) || excludedSinks.has(sinkDescription));
  }

  private _addSinkIfVisible(
    sink: Gvc.MixerSink,
    control: Gvc.MixerControl,
  ): void {
    if (this._sinkItems.has(sink.get_id()) || !this._isSinkVisible(sink)) {
      return;
    }

    const item = new SinkSliderItem(sink, control);
    this._sinkItems.set(sink.get_id(), item);
    this._menu.addMenuItem(item, this._sinkItems.size - 1);
  }

  private _removeSinkById(id: number): void {
    const existing = this._sinkItems.get(id);
    if (!existing) {
      return;
    }

    this._sinkItems.delete(id);
    existing.destroy();
  }

  private _rebuildSinkItems(): void {
    for (const item of this._sinkItems.values()) {
      item.destroy();
    }
    this._sinkItems.clear();

    for (const sink of this._volumeMixerControl.get_sinks()) {
      this._addSinkIfVisible(sink, this._volumeMixerControl);
    }
  }
}

// GObject must be imported for registerClass — available globally in GJS
import GObject from "gi://GObject";

export default class VolumeMixerExtension extends Extension {
  private _indicator: InstanceType<typeof Indicator> | null = null;

  enable() {
    const settings = this.getSettings();
    this._indicator = new Indicator(settings);
    // "volume-mixer" is the role name; the last arg is the box ("left", "center", "right")
    Main.panel.addToStatusArea(this.uuid, this._indicator, 0, "right");
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
  }
}
