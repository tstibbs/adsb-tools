//load with e.g. jQuery.getScript('http://127.0.0.1:8080/ui.cjs?latMin=123&latMax=456&lonMin=789&lonMax=012') - use params to define bounding box, when something enters the box, you'll be notified.

import {init} from './functions.js'

Notification.requestPermission().then((result) => {
	console.log(`Notification permission: ${result}`)
})

init(import.meta.url)
