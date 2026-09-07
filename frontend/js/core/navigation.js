/* ==================== NAWIGACJA SPA ==================== */

function displayWebsocketConnect() {
	connectModalShowStart();
	openModal('connectModal');
}

function displaySong() {
	setElementDisplay('#output', false);
	setElementDisplay('#song', true);
	setElementDisplay('#fullscreenToggleOutput', false);
	document.body.classList.remove('output-view', 'output-fullscreen');
}

// Pokazuje #song bez wybranego utworu (przy utworzeniu kanału)
function displaySongWithChannel() {
	displaySong();
	// Nie renderuj niebezpiecznych widoków
	const unsafeViews = ['text', 'sheets'];
	for (const viewName of viewsList) {
		if (unsafeViews.includes(viewName)) continue;
		refreshPanelContent[viewName]();
	}
}

// Przywraca zapamiętany stan paneli po powrocie z trybu biblioteki i wyborze kanału
function displaySongWithRestoredState() {
	displaySong();
	// Wyrenderuj wszystkie panele (przywrócony stan)
	for (const viewName of viewsList) {
		refreshPanelContent[viewName]();
	}
}

// Czyści zawartość wszystkich paneli — wywołaj po usunięciu utworu
function resetAllPanelsToEmpty() {
	const safeViews = ['socket', 'setlists'];
	for (const viewName of viewsList) {
		if (safeViews.includes(viewName)) continue;
		refreshPanelContent[viewName]();
	}
}

function displayOutput() {
	setElementDisplay('#song', false);
	setElementDisplay('#output', true);
	setElementDisplay('#fullscreenToggleOutput', true);
	document.body.classList.add('output-view');
}
