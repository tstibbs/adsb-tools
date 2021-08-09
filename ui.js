//load with e.g. jQuery.getScript('http://127.0.0.1:8080/ui.cjs?latMin=123&latMax=456&lonMin=789&lonMax=012') - use params to define bounding box, when something enters the box, you'll be notified.

import {Functions} from './functions.js'
let functions = new Functions()

Notification.requestPermission().then((result) => {
	console.log(`Notification permission: ${result}`)
})

const eightHoursInMillis = 8*60*60*1000

let abandonmentTimerId = null

const startAbandonmentTimer = () => {
	abandonmentTimerId = setTimeout(() => {
		stopAbandonmentTimer()
		functions.stopPolling()
		const text = "Stopped polling as the page has been backgrounded for the last eight hours."
		console.log(text)
		new Notification('ADS-B Exchange', {
			body: text,
			requireInteraction: true
		})
	}, eightHoursInMillis)
}

const stopAbandonmentTimer = () => {
	if (abandonmentTimerId != null) {
		clearTimeout(abandonmentTimerId)
		abandonmentTimerId == null
	}
}

function handleVisibilityChange() {
	if (document.hidden) {
		//start our timer
		functions.startPolling()
		//start a timer, if the page is backgrounded for a long time then stop the polling
		startAbandonmentTimer()
	} else {
		//stop our timer, the page will be polling by itself.
		functions.stopPolling()
		//kill our abandonment timer, the page has clearly been visited
		stopAbandonmentTimer()
	}
}
document.addEventListener('visibilitychange', handleVisibilityChange, false)

if (document.hidden) {
	functions.startPolling()
}

functions.init(import.meta.url)
