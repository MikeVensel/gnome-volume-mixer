import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { SettingsSink } from "./models/settings-sink.js";

export default class GnomeRectanglePreferences extends ExtensionPreferences {
  _settings?: Gio.Settings;

  async fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
    this._settings = this.getSettings();

    const page = new Adw.PreferencesPage({
      title: _("General"),
      iconName: "dialog-information-symbolic",
    });

    const deviceGroup = new Adw.PreferencesGroup({
      title: _("Devices"),
      description: _(
        "Hide sinks by name. Select a sink from the dropdown to exclude it from the mixer.",
      ),
    });
    page.add(deviceGroup);

    const excludedSinks = new Set(this._settings!.get_strv("excluded-sinks"));

    // All sink display labels -> canonical sink name (name or description)
    // keyed by the label shown in the UI
    let availableSinks: SettingsSink[] = [];

    const renderedRows: Adw.PreferencesRow[] = [];

    const addManagedRow = (row: Adw.PreferencesRow) => {
      deviceGroup.add(row);
      renderedRows.push(row);
    };

    const syncExcludedSinks = () => {
      this._settings!.set_strv("excluded-sinks", [...excludedSinks].sort());
    };

    const renderExcludedSinkRows = () => {
      for (const row of renderedRows.splice(0)) {
        deviceGroup.remove(row);
      }

      const sortedSinkNames = [...excludedSinks].sort((left, right) =>
        left.localeCompare(right),
      );

      if (sortedSinkNames.length === 0) {
        addManagedRow(
          new Adw.ActionRow({
            title: _("No excluded sinks"),
            subtitle: _("Select a sink below to hide it from the mixer."),
          }),
        );
      }

      for (const sinkName of sortedSinkNames) {
        const row = new Adw.ActionRow({
          title: sinkName,
        });
        const removeButton = new Gtk.Button({
          label: _("Remove"),
          valign: Gtk.Align.CENTER,
        });
        removeButton.add_css_class("destructive-action");
        removeButton.connect("clicked", () => {
          excludedSinks.delete(sinkName);
          syncExcludedSinks();
          renderExcludedSinkRows();
        });
        row.add_suffix(removeButton);
        row.activatable_widget = removeButton;
        addManagedRow(row);
      }

      // Build a string list model of non-excluded sinks
      const nonExcluded = availableSinks.filter(
        (s) => !excludedSinks.has(s.name),
      );

      const stringList = new Gtk.StringList();
      for (const sink of nonExcluded) {
        stringList.append(sink.label);
      }

      const comboRow = new Adw.ComboRow({
        title: _("Exclude sink"),
        model: stringList,
        selected: Gtk.INVALID_LIST_POSITION,
      });

      const addButton = new Gtk.Button({
        label: _("Exclude"),
        valign: Gtk.Align.CENTER,
      });
      addButton.add_css_class("suggested-action");
      addButton.sensitive = false;

      comboRow.connect("notify::selected", () => {
        addButton.sensitive = comboRow.selected !== Gtk.INVALID_LIST_POSITION;
      });

      addButton.connect("clicked", () => {
        const idx = comboRow.selected;
        if (idx === Gtk.INVALID_LIST_POSITION || idx >= nonExcluded.length) {
          return;
        }
        excludedSinks.add(nonExcluded[idx].name);
        syncExcludedSinks();
        renderExcludedSinkRows();
      });

      comboRow.add_suffix(addButton);

      if (nonExcluded.length === 0) {
        comboRow.subtitle = _("All detected sinks are already excluded.");
        comboRow.sensitive = false;
        addButton.sensitive = false;
      }

      addManagedRow(comboRow);
    };

    window.add(page);

    // Use pactl to discover available sinks, then render.
    // Falls back to an empty list (combo will show no options) if pactl is unavailable.
    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        renderExcludedSinkRows();
        resolve();
      };

      try {
        const proc = Gio.Subprocess.new(
          ["pactl", "--format=json", "list", "sinks"],
          Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        );

        proc.communicate_utf8_async(null, null, (_proc, result) => {
          try {
            const [, stdout] = proc.communicate_utf8_finish(result);
            if (stdout) {
              type PactlSink = { name: string; description: string };
              const sinks: PactlSink[] = JSON.parse(stdout);
              availableSinks = sinks.map((s) => {
                const label = (s.description ?? s.name).trim();
                return { label, name: label };
              });
            }
          } catch {
            // pactl output unparseable; fall back to empty list
          }
          finish();
        });
      } catch {
        // pactl not found; fall back to empty list
        finish();
      }
    });
  }
}
