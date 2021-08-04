Only tested on Chrome. Definitely won't work on IE.

Create a bookmarklet with the following contents:

`javascript:` + a url-encoded version of `$('head').append('<script type="module" src="https://tstibbs.github.io/ui.js?latMin=51.6618&latMax=51.6942&lonMin=-1.8363&lonMax=-1.7299"></script>')`

Set the lat/lon min/max to represent the coordinates of a bounding box - you will not be notified about aircraft outside of this box.

Note two additional optional params:
* `maxHeight`: don't notify about aircraft above this altitude (measured in feet)
* `direction`: only notify about aircraft travelling in a direction within 20 degrees either side of this parameter.

Visit https://globe.adsbexchange.com

Run your bookmarket

Note that the screen will have to show the area you're interested in - if the lat/lon parameters are off screen then you will likely get no notifications.
