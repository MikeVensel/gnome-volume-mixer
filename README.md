# Volume Mixer

This is an extension I wrote for myself to control the volume for multiple audio sinks when not connected to my Stream Deck.

## Building

Clone the repository and run the install:

```shell
git clone https://github.com/MikeVensel/gnome-volume-mixer.git
cd gnome-volume-mixer
make install
```

You will then need to either logout and back in and then enable the extension in Extension Manager.

## Settings

### Devices

This lets you choose sinks/devices which you want to exclude from the volume mixer. The list of available devices to exclude is retrieved by running `pactl --format=json list sinks` and will also remove any sinks which have already been excluded.