class Functions {
	constructor() {
		this.oldWqi = globalThis.wqi
		this.seenHexes = []
		this.craftPoints = {}
	}

	//this only needs to be called in the UI, not required for testing
	async init(mainScriptUrl) {
		const scriptUrl = new URL(mainScriptUrl)
		const scriptDir = scriptUrl.origin + scriptUrl.pathname.split('/').slice(0, -1).join('/')
		const searchParams = scriptUrl.searchParams

		this.registrationPrefixes = await jQuery.ajax(`${scriptDir}/registrationPrefixes.json`)

		function getParam(name) {
			let param = searchParams.get(name)
			if (param == null) {
				return null
			} else {
				return parseFloat(param)
			}
		}

		this.latMin = getParam('latMin')
		this.latMax = getParam('latMax')
		this.lonMin = getParam('lonMin')
		this.lonMax = getParam('lonMax')
		this.maxHeight = getParam('maxHeight')//measured in feet
		this.direction = getParam('direction')//degrees
		let {latMin, latMax, lonMin, lonMax, maxHeight, direction} = this
		console.log({latMin, latMax, lonMin, lonMax, maxHeight, direction})
		globalThis.wqi = this.newWqi.bind(this)
	}

	startPolling() {
		this.stopPolling()
		this.pollingIntervalId = setInterval(globalThis.fetchData, 30*1000)//means it will be fetched even if we are off the screen
	}

	stopPolling() {
		if (this.pollingIntervalId != null) {
			clearInterval(this.pollingIntervalId)
			this.pollingIntervalId == null
		}
	}

	async newWqi(...args) {
		this.oldWqi(...args)
		let result = args[0]
		let crafts = result.aircraft.filter(craft =>
			craft != undefined && craft.alt_baro != undefined && craft.alt_baro != "ground" && craft.lat != undefined && craft.lon != undefined
		).map(craft => ({
			height: craft.alt_baro, //in feet
			lat: craft.lat,
			lon: craft.lon,
			registration: craft.r,
			flight: craft.flight,
			type: craft.t,
			hex: craft.hex
		}))
		crafts = crafts.filter(craft =>
			craft.lat > this.latMin && craft.lat < this.latMax && craft.lon > this.lonMin && craft.lon < this.lonMax
		)
		crafts = crafts.filter(craft =>
			!this.seenHexes.includes(craft.hex)
		)
		if (this.maxHeight != null) {
			crafts = crafts.filter(craft =>
				craft.height <= this.maxHeight
			)
		}
		if (crafts.length > 0 && this.direction != null) {
			//store first point that we see this craft at
			//then as soon as we get a second point, calculate the bearing
			//if non-matching, ignore for now, but store the new point
			//repeat, in case it turns onto the right track
			crafts = crafts.filter(craft => {
				const previous = this.craftPoints[craft.hex]
				const current = {lat: craft.lat, lon: craft.lon}
				this.craftPoints[craft.hex] = current
				if (previous == undefined) {
					return false//filter out for now, filtering out here doesn't add to seenHexes so it will still be evaluated in the next run
				} else {
					let bearing = this.calculateBearing(previous, current)
					return this.bearingCloseEnough(this.direction, bearing)
				}
			})
		}
		if (crafts.length > 0) {
			this.seenHexes.push.apply(this.seenHexes, crafts.map(craft => craft.hex))
			crafts.forEach(this.processNewCraft.bind(this))//no need to wait for this, might as well fire them off in parallel
		}
	}

	showNotification(text, unique) {
		console.log(unique)
		let notif = new Notification('ADS-B Exchange', {
			body: text,
			requireInteraction: true,
			renotify: true,
			tag: unique
		})
		let response = {
			closed: false
		}
		notif.addEventListener('close', event => {response.closed = true})
		return response
	}

	async processNewCraft(craft) {
		let data = await this.fetchTraces(craft.hex)
		const {historic, recent, desc} = data
		const craftInfo = `${desc} (${craft.registration})`
		const unique = `${craft.hex}-${Date.now()}`
		let notificationResponse = this.showNotification(craftInfo, unique)
		const startPoint = this.findStartPoint(historic, recent)
		console.debug(`DEBUG: hex/icao=${craft.hex}, type=${craft.type}, callsign=${craft.flight?.trim()}, startPoint=${startPoint.join(',')}`)
		try {
			let text = await this.geocode(startPoint[0], startPoint[1])
			text = `${craftInfo} started from ${text}`
			let demonym = this.getDemonymForReg(craft.registration)
			if (demonym != null) {
				text = `${demonym} ${text}`
			}
			console.log(text)
			if (notificationResponse.closed === false) {
				this.showNotification(text, unique) //replace the current notification now we have geocoding info
			} else {
				console.log('Not showing notification as initial version was closed.')
			}
		} catch (e) {
			console.error(e)
			console.log(`${craftInfo} [error getting location info, see debug for coords]`)
			throw e
		}
	}

	buildGeocodeQuery(lat, lon) {
		return `[timeout:10][out:json];
is_in(${lat},${lon})->.a;
way(pivot.a);
out tags;
relation(pivot.a);
out tags;`
	}

	buildNearbyQuery(lat, lon) {
		return `[timeout:10][out:json];
node(around:2000,${lat},${lon})->.nearby;
(
	node.nearby[aeroway=aerodrome];
	node.nearby[aerodrome];
)->.nearbyAirports;
.nearbyAirports out tags meta;`
	}

	async queryOverpass(query) {
		return await jQuery.ajax({
			url: 'https://overpass-api.de/api/interpreter',
			data: query,
			dataType: 'json',
			method: 'POST'
		})
	}

	parseAirport(airport) {
		let airportName = airport.tags['name:en'] || airport.tags.name
		let code = airport.tags.iata
		if (code != null) {
			airportName += ` (${code})`
		}
		let cityName = airport.tags['city_served']
		return {
			airportName,
			cityName
		}
	}

	async geocode(lat, lon) {
		let query = this.buildGeocodeQuery(lat, lon)
		let result = await this.queryOverpass(query)

		let countryName = null
		let airportName = null
		let cityName = null
		let elements = result.elements == null ? [] : result.elements.filter(element => element.tags != undefined)
		let countries = elements.filter(element => element.tags != undefined && element.tags['admin_level'] == "2")
		if (countries.length > 0) {
			//if there are multiple, pick the one with the 'ISO3166-1' tag, otherwise pick the one with the most tags, otherwise just pick whatever's first
			countries = countries.sort((a, b) => {
				let aIso = 'ISO3166-1' in a.tags
				let bIso = 'ISO3166-1' in b.tags
				if (aIso && !bIso) {
					return -1;
				} else if (bIso && !aIso) {
					return 1;
				} else {
					return Object.entries(b.tags).length - Object.entries(a.tags).length //return positive number if you want b to appear before a (i.e. if it is longer)
				}
			})
			let country = countries[0]
			countryName = country.tags['name:en'] || country.tags.name
		}
		// if tags contains aerodrome or "aeroway"="aerodrome" then use this one
		let airport = elements.find(element => element.tags['aerodrome'] != undefined || element.tags['aeroway'] == 'aerodrome')
		if (airport != null) {
			let parsed = this.parseAirport(airport)
			airportName = parsed.airportName
			cityName = parsed.cityName
		}
		if (airportName == null) {
			//point not enclosed by any airport way or relation, so go looking for a nearby airport _node_
			let nearbyQuery = this.buildNearbyQuery(lat, lon)
			let nearbyResult = await this.queryOverpass(nearbyQuery)
			let nearbyelements = nearbyResult.elements.filter(element => element.tags != undefined)
			let aerodromes = nearbyelements.filter(element => element.tags['aerodrome'] != undefined || element.tags['aeroway'] == 'aerodrome')
			if (aerodromes.length > 0) {
				let aerodrome = aerodromes[0]
				if (aerodromes.length > 1) {
					let distances = []
					let aerodromesByDistance = Object.fromEntries(aerodromes.map(element => {
						element.lon
						element.lat
						let x = Math.abs(lon - element.lon)
						let y = Math.abs(lat - element.lat)
						let distance = Math.sqrt(x^2 + y^2)
						distances.push(distance)
						return [`${distance}`, element]
					}))
					aerodrome = aerodromesByDistance[`${distances.sort()[0]}`]
				}
				let parsed = this.parseAirport(aerodrome)
				airportName = parsed.airportName
				cityName = parsed.cityName
			}
		}

		let city = null
		if (cityName == null) {
			city = elements.find(element => element.tags['place'] == 'city');//semi colon to force a new statement evaluation because chrome thinks the array below is indexing into the result of the line above
			//note administrative levels are ordered like this deliberately - 6 is a county boundary which isn't ideal (too big) but is a decent fallback if we don't find anything at the others
			["7", "8", "9", "6"].forEach(level => {
				if (city == null) {
					city = elements.find(element => element.tags['admin_level'] == level)
				}
			})
		}
		if (city != null) {
			cityName = city.tags['name:en'] || city.tags.name
		}
		if (airportName == null) {
			console.debug(`airportName == null`)
		}
		if (cityName == null) {
			console.debug(`cityName == null`)
		}
		if (countryName == null) {
			console.debug(`countryName == null`)
		}
		let results = [airportName, cityName, countryName].filter(name =>
			name != null
		).filter((name, i, arr) =>
			//filter out any entries that are already contained in previous strings
			arr.slice(0, i).find(previousName =>
				previousName.includes(name) || name.includes(previousName)
			) == null
		).join(', ')
		return results
	}

	normalizeTraceStamps(data) {
		return data.trace.map(point => [point[0] + data.timestamp, ...point.slice(1)])
	}

	buildAllTraces(historic, recent) {
		historic = this.normalizeTraceStamps(historic)
		recent = this.normalizeTraceStamps(recent)
		let recentStart = recent[0][0]
		let recentCutoff = historic.findIndex(point => point[0] > recentStart)
		if (recentCutoff != -1) {
			historic = historic.slice(0, recentCutoff)
		}
		let trace = historic.concat(recent)
		return trace
	}

	buildCurrentTrace(trace) {
		let details = trace.filter(point => point[8] != null && typeof point[8] === 'object')
		let flight = details[details.length - 1][8].flight
		let startOfFlight = trace.findIndex(point => point[8] != null && typeof point[8] === 'object' && point[8].flight == flight)
		if (startOfFlight == -1) {
			startOfFlight = 0
		}
		//it appears that if you bitwise and with 2, then a non-zero answer indicates some kind of 'new leg' flag
		//weird spread in the next line is because `reverse` reverses the array *in place* which is not what we want in this case
		let lastNonLegFlag = [...trace].reverse().findIndex(point => (point[6] & 2) != 0)
		if (lastNonLegFlag == -1) {
			lastNonLegFlag = 0
		} else {
			lastNonLegFlag = trace.length - lastNonLegFlag //undo the reverse
		}
		console.debug(`trace.length=${trace.length}, startOfFlight=${startOfFlight}, lastNonLegFlag=${lastNonLegFlag}`)
		console.debug(`startOfFlight: ${trace[startOfFlight][0]}, ${trace[startOfFlight][1]},${trace[startOfFlight][2]}`)
		console.debug(`lastNonLegFlag: ${trace[lastNonLegFlag][0]}, ${trace[lastNonLegFlag][1]},${trace[lastNonLegFlag][2]}`)
		trace = trace.slice(Math.max(startOfFlight, lastNonLegFlag), trace.length)
		return trace
	}

	findStartPoint(historic, recent) {
		let allTraces = this.buildAllTraces(historic, recent)
		let trace = this.buildCurrentTrace(allTraces)
		if (trace.length == 0 || trace[0] == undefined) {
			console.error(`Something weird happened. historic=${historic}, recent=${recent}, allTraces.length=${allTraces.length}, trace.length=${trace.length}`)
		}
		let startPoint = [trace[0][1], trace[0][2]]
		return startPoint
	}

	async fetchTraces(hex) {
		hex = hex.toLowerCase()

		let url1 = 'data/traces/'+ hex.slice(-2) + '/trace_recent_' + hex + '.json';
		let url2 = 'data/traces/'+ hex.slice(-2) + '/trace_full_' + hex + '.json';

		let req1 = jQuery.ajax({ url: url1,
			dataType: 'json'
		});

		let req2 = jQuery.ajax({ url: url2,
			dataType: 'json'
		});

		let [recent, historic] = await Promise.all([req1, req2])
		let desc = recent.desc
		return {historic, recent, desc}
	}

	calculateBearing(point1, point2) {
		const lat1 = point1.lat
		const lon1 = point1.lon
		const lat2 = point2.lat
		const lon2 = point2.lon
		//following code borrowed from https://www.movable-type.co.uk/scripts/latlong.html
		const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
		const x = (Math.cos(lat1) * Math.sin(lat2)) - (Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1))
		const rawAngle = Math.atan2(y, x)
		const bearing = (((rawAngle * 180) / Math.PI) + 360) % 360 // in degrees
		return bearing
	}

	bearingCloseEnough(expected, actual) {
		const variance = 20 //i.e. this much either way is allowed, so total range will be twice this value
		const min = expected - variance
		const max = expected + variance

		if (min >= 0 && max <= 360) {
			return actual >= min && actual <= max
		} else if (min < 0 && max <= 360) {
			return actual >= (min + 360) || actual <= max
		} else if (min >= 0 && max > 360) {
			return actual >= min || actual <= (max - 360)
		} else {//if (min < 0 && max > 360)
			throw new Error(`Something went wrong: ${JSON.stringify({expected, actual, variance, min, max})}`)
		}
	}

	getRegistrationPrefixes() {
		return this.registrationPrefixes
	}

	getDemonymForReg(reg) {
		//registrations are weirdly overlapping, for example P- and PK- belong to completely different countries, but the list we have doesn't (necessarily) specify the hyphen
		let potentials = Object.entries(this.getRegistrationPrefixes()).filter(([prefix, demonym]) =>
			reg.startsWith(prefix)
		).sort(([prefixA, demonymA], [prefixB, demonymB]) =>
			prefixB.length - prefixA.length
		)
		let maxPotentialLength = Math.max(...(potentials.map(([prefix, demonym]) => prefix.length)))
		//get all the most likely based on being the longest
		potentials = potentials.filter(([prefix, demonym]) =>
			prefix.length == maxPotentialLength
		).map(([prefix, demonym]) =>
			demonym
		)
		if (!reg.includes('-') && reg.startsWith('Z')) {
			potentials.push("British(?) military")
		}
		return potentials.join('/')//combine into a single string for display
	}
}

export {Functions}
