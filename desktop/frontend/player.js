(() => {
  let player;
  let hls;
  let activeRequest = 0;
  let preparedPath;
  let pendingPlaybackWork = 0;

  window.isOutputPlaybackBusy = () => Boolean(player?.dialog.open || pendingPlaybackWork);

  async function release(path) {
    if (!path) return;
    pendingPlaybackWork += 1;
    try {
      await window.__TAURI__.core.invoke('release_player', { path });
    } finally {
      pendingPlaybackWork -= 1;
    }
  }

  function createPlayer() {
    const dialog = document.createElement('dialog');
    dialog.className = 'output-player';
    dialog.setAttribute('aria-labelledby', 'player-title');
    dialog.innerHTML = `
      <div class="panel-heading player-heading">
        <h2 id="player-title" data-i18n="playOutput"></h2>
        <form method="dialog"><button class="btn icon-only" data-i18n-label="closePlayer" autofocus><span class="icon icon-cross" aria-hidden="true"></span></button></form>
      </div>
      <div class="player-body">
        <div class="player-frame">
          <video playsinline preload="metadata" data-i18n-label="outputVideo"></video>
          <div class="player-controls">
            <input class="player-range player-seek" type="range" min="0" max="1" value="0" step="0.01" data-i18n-label="playbackPosition" disabled>
            <div class="player-transport">
              <button type="button" class="player-button player-toggle" disabled><span class="icon icon-play" aria-hidden="true"></span></button>
              <span class="player-time" dir="ltr">0:00 / 0:00</span>
              <div class="player-audio">
                <button type="button" class="player-button player-mute"><span class="icon icon-volume" aria-hidden="true"></span></button>
                <input type="range" class="player-range player-volume" min="0" max="1" step="0.05" value="1" data-i18n-label="volume">
              </div>
              <label class="visually-hidden" for="player-speed" data-i18n="playbackSpeed"></label>
              <select id="player-speed">
                <option value="0.5"></option>
                <option value="1" selected></option>
                <option value="1.5"></option>
                <option value="2"></option>
              </select>
              <button type="button" class="player-button player-fullscreen"><span class="icon icon-fullscreen" aria-hidden="true"></span></button>
            </div>
          </div>
        </div>
        <p class="player-message" role="status" hidden></p>
      </div>`;
    const video = dialog.querySelector('video');
    const message = dialog.querySelector('.player-message');
    const frame = dialog.querySelector('.player-frame');
    const toggle = dialog.querySelector('.player-toggle');
    const seek = dialog.querySelector('.player-seek');
    const mute = dialog.querySelector('.player-mute');
    const volume = dialog.querySelector('.player-volume');
    const speed = dialog.querySelector('#player-speed');
    const time = dialog.querySelector('.player-time');
    const fullscreen = dialog.querySelector('.player-fullscreen');
    i18n.apply(dialog);
    document.body.append(dialog);
    const speedControl = enhanceSelects([speed]);

    function clock(seconds) {
      const total = Math.floor(seconds || 0);
      const minutes = Math.floor(total / 60);
      return `${minutes}:${String(total % 60).padStart(2, '0')}`;
    }

    function renderControls() {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const position = duration ? Math.min(video.currentTime, duration) : 0;
      const gain = video.muted ? 0 : video.volume;
      seek.disabled = duration <= 0;
      seek.max = duration || 1;
      seek.value = position;
      seek.style.setProperty('--range-fill', `${duration ? 100 * position / duration : 0}%`);
      time.textContent = `${clock(position)} / ${clock(duration)}`;
      toggle.disabled = video.readyState === 0;
      toggle.setAttribute('aria-label', i18n.t(video.paused ? 'playVideo' : 'pauseVideo'));
      toggle.firstElementChild.className = `icon icon-${video.paused ? 'play' : 'pause'}`;
      volume.value = gain;
      volume.style.setProperty('--range-fill', `${100 * gain}%`);
      mute.setAttribute('aria-label', i18n.t(gain ? 'mute' : 'unmute'));
      mute.firstElementChild.className = `icon icon-${gain ? 'volume' : 'muted'}`;
    }

    function togglePlayback() {
      if (video.paused) video.play().catch(() => showError(i18n.t('cannotStartPlayback')));
      else video.pause();
    }

    toggle.addEventListener('click', togglePlayback);
    video.addEventListener('click', () => { if (video.readyState) togglePlayback(); });
    seek.addEventListener('input', () => { video.currentTime = seek.valueAsNumber; });
    mute.addEventListener('click', () => {
      const audible = !video.muted && video.volume > 0;
      if (video.volume === 0) video.volume = 1;
      video.muted = audible;
    });
    volume.addEventListener('input', () => {
      video.volume = volume.valueAsNumber;
      video.muted = video.volume === 0;
    });
    speed.addEventListener('change', () => { video.playbackRate = Number(speed.value); });
    fullscreen.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement === frame) await document.exitFullscreen();
        else await frame.requestFullscreen();
      } catch { showError(i18n.t('noFullscreen')); }
    });
    function renderFullscreen() {
      fullscreen.setAttribute('aria-label', i18n.t(document.fullscreenElement === frame ? 'exitFullscreen' : 'fullscreen'));
    }

    function renderLanguage() {
      for (const option of speed.options) option.textContent = `${i18n.formats.decimal.format(Number(option.value))}×`;
      speedControl.sync();
      renderControls();
      renderFullscreen();
    }
    document.addEventListener('fullscreenchange', renderFullscreen);
    document.addEventListener('language-changed', renderLanguage);
    for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'volumechange', 'emptied']) {
      video.addEventListener(event, renderControls);
    }
    renderLanguage();
    dialog.addEventListener('close', () => {
      activeRequest += 1;
      if (document.fullscreenElement === frame) document.exitFullscreen().catch(() => {});
      hls?.destroy();
      hls = undefined;
      video.pause();
      video.removeAttribute('src');
      video.load();
      renderControls();
      void release(preparedPath).catch(() => {});
      preparedPath = null;
    });
    video.addEventListener('error', () => {
      if (dialog.open) showError(i18n.t('cannotPlay'));
    });
    return { dialog, video, message };
  }

  function showError(text) {
    player.message.textContent = text;
    player.message.hidden = false;
  }

  window.playConvertedOutput = async (path) => {
    player ??= createPlayer();
    if (player.dialog.open) return;
    player.message.hidden = true;
    player.dialog.showModal();
    const request = ++activeRequest;
    pendingPlaybackWork += 1;
    try {
      const { invoke, convertFileSrc } = window.__TAURI__.core;
      const media = await invoke('prepare_player', { path });
      if (request !== activeRequest || !player.dialog.open) {
        await release(media);
        return;
      }
      preparedPath = media;
      const isHls = media.toLowerCase().endsWith('.m3u8');
      const asset = convertFileSrc(media);
      if (isHls && window.Hls?.isSupported()) {
        // Keep path boundaries so the manifest can address its adjacent segments and key.
        const manifest = asset.replace(/%5c|%2f/gi, '/');
        hls = new window.Hls({ enableWorker: false });
        hls.on(window.Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) showError(i18n.t('cannotPlayHls'));
        });
        hls.attachMedia(player.video);
        hls.loadSource(manifest);
      } else if (!isHls || player.video.canPlayType('application/vnd.apple.mpegurl')) {
        player.video.src = isHls ? asset.replace(/%5c|%2f/gi, '/') : asset;
      } else {
        showError(i18n.t('hlsNotSupported'));
      }
    } catch (error) {
      if (request === activeRequest && player.dialog.open) showError(String(error));
    } finally {
      pendingPlaybackWork -= 1;
    }
  };
})();
