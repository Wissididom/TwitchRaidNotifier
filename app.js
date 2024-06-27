var accessToken = getHashValue('access_token');
var user = null;
var exponentialBackoff = 0;
var sessionId = null;
var subscriptionIdMapping = {};

function getHashValue(key) {
	matches = location.hash.match(new RegExp(key+'=([^&]*)'));
	return matches ? matches[1] : null;
}

// https://dev.twitch.tv/docs/api/reference/#get-users
async function getUsers(logins) {
	if (logins.length > 100) {
		return [...getUsers(logins.slice(0, 100)), ...getUsers(logins.slice(101))]
	}
	if (logins.length < 1) {
		return null;
	}
	for (let i = 0; i < logins.length; i++) {
		logins[i] = `login=${logins[i]}`;
	}
	return (await fetch(`https://api.twitch.tv/helix/users?${logins.join("&")}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Client-ID': 'wweh14eztzydijacmb85rk7n7gf57m',
			'Authorization': `Bearer ${accessToken}`
		}
	}).then(res => res.json())).data;
}

// https://dev.twitch.tv/docs/api/reference/#create-eventsub-subscription
async function createEventSubSubscription(fromBroadcasterUserId) {
	await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Client-ID': 'wweh14eztzydijacmb85rk7n7gf57m',
			'Authorization': `Bearer ${accessToken}`
		},
		body: JSON.stringify({
			type: 'channel.raid',
			version: '1',
			condition: {
				from_broadcaster_user_id: fromBroadcasterUserId
			},
			transport: {
				method: 'websocket',
				session_id: sessionId
			}
		})
	}).then(async res => {
		switch (res.status) {
			case 202: // 202 Accepted
				let json = await res.json();
				if (json.data[0].id) subscriptionIdMapping[fromBroadcasterUserId] = json.data[0].id;
				return json.data[0].id;
				break;
			case 400: // 400 Bad Request
				return null;
				break;
			case 401: // 401 Unauthorized
				return null;
				break;
			case 403: // 403 Forbidden - The access token is missing the required scopes (cannot happen because channel.raid does not need any authorization)
				return null;
				break;
			case 409: // 409 Conflict - event and type combination already exists
				return null
				break;
			case 429: // 429 Too Many Requests
				return null
				break;
		}
	});
}

// https://dev.twitch.tv/docs/api/reference/#delete-eventsub-subscription
async function deleteEventSubSubscription(subscriptionId) {
	await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${subscriptionId}`, {
		method: 'DELETE',
		headers: {
			'Content-Type': 'application/json',
			'Client-ID': 'wweh14eztzydijacmb85rk7n7gf57m',
			'Authorization': `Bearer ${accessToken}`
		}
	}).then(async res => {
		switch (res.status) {
			case 204: // 204 No Content
				// TODO
				break;
			case 400: // 400 Bad Request - id query parameter missing
				// TODO
				break;
			case 401: // 401 Unauthorized
				// TODO
				break;
			case 404: // 404 Not Found - The subscription was not found
				// TODO
				break;
		}
	}).catch(err => {
		// TODO
	});
}

// https://dev.twitch.tv/docs/api/reference/#get-eventsub-subscriptions
async function getEventSubSubscription() {
	await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?status=enabled&type=channel.raid&user_id=${user.id}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Client-ID': 'wweh14eztzydijacmb85rk7n7gf57m',
			'Authorization': `Bearer ${accessToken}`
		}
	}).then(async res => {
		switch (res.status) {
			case 200: // 200 OK
				// TODO
				break;
			case 400: // 400 Bad Request
				// TODO
				break;
			case 401: // 401 Unauthorized
				// TODO
				break;
		}
	}).catch(err => {
		// TODO
	});
}

async function connectWs() {
	let keepaliveTimeoutSeconds = {
		start: 0,
		ernd: 0,
		interval: 0
	}
	let keepaliveTimeoutInterval = setInterval(() => {
		if (keepaliveTimeoutSeconds.start > 0 && keepaliveTimeoutSeconds.end > 0) {
			if (keepaliveTimeoutSeconds.end - keepaliveTimeoutSeconds.start > 10) {
				connectWs();
			}
		}
	}, 1000);
	let client = new WebSocket("wss://eventsub.wss.twitch.tv/ws");
	let onopen = (event) => {
		console.log("EventSub connection established!");
		exponentialBackoff = 0;
	};
	let onmessage = async (event) => {
		let data = JSON.parse(event.data);
		if (data.metadata?.message_type == "session_welcome") {
			console.log(`session_welcome: ${JSON.stringify(data)}`);
			sessionId = data.payload.session.id;
			keepaliveTimeoutSeconds.interval = data.payload.session.keepalive_timeout_seconds;
			let channelList = document.getElementById("channelList");
			let users = [];
			for (let i = 0; i < channelList.length; i++) {
				users.push(channelList[i].text.toLowerCase().replace('@', ''));
			}
			users = await getUsers(users);
			for (let i = 0; i < users.length; i++) {
				await createEventSubSubscription(users[i].id);
			}
		} else if (data.metadata?.message_type == "session_keepalive") {
			console.log(`session_keepalive: ${JSON.stringify(data)}`);
		} else if (data.metadata?.message_type == "session_reconnect") {
			console.log(`session_reconnect: ${JSON.stringify(data)}`);
			console.log(`Reconnecting to ${data.payload.session.reconnect_url}`);
			client = new WebSocket(data.payload.session.reconnect_url);
			client.onopen = onopen;
			client.onmessage = onmessage;
			client.onclose = onclose;
			client.onerror = onerror;
		} else if (data.payload?.subscription?.type == "channel.raid") {
			console.log(`channel.raid: ${JSON.stringify(data)}`);
			console.log(`${data.payload.event.from_broadcaster_user_name} is raiding ${data.payload.event.to_broadcaster_user_name} with ${data.payload.event.viewers} viewers!`);
			let audio = new Audio('assets/sound.mp3');
			audio.play();
		} else {
			console.log(`EventSub Data: ${JSON.stringify(data)}`);
		}
		keepaliveTimeoutSeconds.start = Date.now() / 1000;
		keepaliveTimeoutSeconds.end = keepaliveTimeoutSeconds.start + keepaliveTimeoutSeconds.interval;
	};
	let onclose = (event) => {
		console.log(`EventSub connection closed! (Code: ${event.code}; Reason: ${event.reason})`);
		if (!event.wasClean) {
			console.log(`Connection didn't close in a clean manner! Maybe just the connection was lost! Trying to reconnect... (exponential backoff ${exponentialBackoff})`);
			if (exponentialBackoff == 0) {
				connectWs();
				exponentialBackoff = 100;
			} else {
				setTimeout(() => {
					connectWs();
				}, exponentialBackoff);
			}
			exponentialBackoff *= 2;
		}
	};
	let onerror = (event) => {
		console.log(`EventSub connection errored!`);
	}
	client.onopen = onopen;
	client.onmessage = onmessage;
	client.onclose = onclose;
	client.onerror = onerror;
}

async function subChannel() {
	let channelName = document.getElementById("channelName").value.toLowerCase().replace('@', '');
	let channelList = document.getElementById("channelList");
	let option = document.createElement("option");
	option.value = users[0].id;
	option.text = channelName;
	channelList.appendChild(option);
	if (channelList.length < 1) {
		await connectWs();
	}
	let users = await getUsers([channelName]);
	if (sessionId) {
		await createEventSubSubscription(users[0].id);
	}
}

async function unsubChannel() {
	let channelList = document.getElementById("channelList");
	let subId = subscriptionIdMapping[channelList[channelList.selectedIndex].value];
	await deleteEventSubSubscription(subId);
	channelList.remove(channelList.selectedIndex);
}

if (window.accessToken) {
	document.getElementById('authorize').style.display = 'none';
	document.getElementById('channelName').style.display = 'inline';
	document.getElementById('addChannel').style.display = 'inline';
	document.getElementById('removeChannel').style.display = 'inline';
	document.getElementById('monitoredSpan').style.display = 'inline';
	document.getElementById('channelList').style.display = 'inline';
	(async () => {
		window.user = (await fetch('https://api.twitch.tv/helix/users', {
			headers: {
				'Client-ID': 'wweh14eztzydijacmb85rk7n7gf57m',
				'Authorization': `Bearer ${accessToken}`
			}
		}).then(res => res.json()).then(json => json.data[0]));
	})();
}
