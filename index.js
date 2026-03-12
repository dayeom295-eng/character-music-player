/**
 * Character Music Player Extension for SillyTavern
 * v1.3 — 안정화 최종판
 *
 * 재생 방식:
 *  - API 키 있음: YouTube 검색 → 앨범아트 표시 + ▶ 클릭 시 YouTube 새 탭으로 열기
 *  - API 키 없음: YouTube 검색 링크로 새 탭 열기
 *
 * (YouTube embed는 localhost origin을 차단하므로 내부 재생 불가)
 */

(async function () {
    const {
        eventSource,
        event_types,
        extensionSettings: extension_settings,
        saveSettingsDebounced,
    } = SillyTavern.getContext();

    const EXTENSION_NAME = 'character-music-player';

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        youtubeApiKey: '',
        cooldownMinutes: 3,
        triggerSensitivity: 'medium',
        cardStyle: 'full',
    });

    const TRIGGER_PATTERNS = [
        '분노','화가','격분','열받','짜증','슬픔','눈물','울음','설렘','두근',
        '흥분','황홀','절망','그리움','외로움','쓸쓸','긴장','두려움',
        '怒','悲','泣','嬉','寂',
        '음악','노래','곡','멜로디','리듬','흥얼','콧노래','듣고 있','틀어',
        '플레이리스트','이어폰','헤드폰','BGM','음악을','노래를',
        '音楽','歌','曲',
        '새벽','늦은 밤','저녁 노을','황혼','달빛','빗소리','비가 내리','눈이 내리',
        '카페','드라이브','혼자','창가','침대','잠들기 전','귀갓길',
        '深夜','夜','雨','一人',
    ];

    let lastCardTime = 0;
    let isProcessing = false;

    // ===== 설정 =====
    function getSettings() {
        if (!extension_settings[EXTENSION_NAME]) {
            extension_settings[EXTENSION_NAME] = structuredClone(DEFAULT_SETTINGS);
        }
        for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
            if (!Object.hasOwn(extension_settings[EXTENSION_NAME], k)) {
                extension_settings[EXTENSION_NAME][k] = v;
            }
        }
        return extension_settings[EXTENSION_NAME];
    }

    // ===== 초기화 =====
    async function initExtension() {
        const s = getSettings();

        const settingsHtml = await $.get(
            `scripts/extensions/third-party/${EXTENSION_NAME}/settings.html`
        );
        $('#extensions_settings').append(settingsHtml);

        $('#cmp-enabled').prop('checked', s.enabled);
        $('#cmp-apikey').val(s.youtubeApiKey || '');
        $('#cmp-cooldown').val(s.cooldownMinutes);
        $('#cmp-sensitivity').val(s.triggerSensitivity);
        $('#cmp-cardstyle').val(s.cardStyle || 'full');

        $('#cmp-enabled').on('change', function () {
            getSettings().enabled = this.checked; saveSettingsDebounced();
        });
        $('#cmp-apikey').on('input', function () {
            getSettings().youtubeApiKey = this.value.trim(); saveSettingsDebounced();
        });
        $('#cmp-cooldown').on('input', function () {
            getSettings().cooldownMinutes = parseInt(this.value) || 3; saveSettingsDebounced();
        });
        $('#cmp-sensitivity').on('change', function () {
            getSettings().triggerSensitivity = this.value; saveSettingsDebounced();
        });
        $('#cmp-cardstyle').on('change', function () {
            getSettings().cardStyle = this.value; saveSettingsDebounced();
        });

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        console.log(`[${EXTENSION_NAME}] 로드 완료 v1.3 ✅`);
    }

    // ===== 메시지 수신 =====
    async function onMessageReceived(messageIdOrData) {
        const s = getSettings();
        if (!s?.enabled) return;
        if (isProcessing) return;

        const now = Date.now();
        if (now - lastCardTime < s.cooldownMinutes * 60 * 1000) return;

        const context = SillyTavern.getContext();
        const messages = context?.chat;
        if (!messages?.length) return;

        const lastMsg = messages[messages.length - 1];
        if (!lastMsg || lastMsg.is_user) return;

        let messageId;
        if (typeof messageIdOrData === 'number') {
            messageId = messageIdOrData;
        } else if (typeof messageIdOrData === 'object' && messageIdOrData !== null) {
            messageId = messageIdOrData.mesid ?? messageIdOrData.id ?? (messages.length - 1);
        } else {
            messageId = messages.length - 1;
        }

        const text = lastMsg.mes || '';
        const triggered = await checkTrigger(text, s.triggerSensitivity, context);
        if (!triggered) return;

        isProcessing = true;
        lastCardTime = now;

        try {
            const musicInfo = await requestMusic(text, context);
            if (!musicInfo) return;
            const videoInfo = await searchYouTube(musicInfo, s.youtubeApiKey);
            renderCard(musicInfo, videoInfo, messageId, context, s.cardStyle || 'full');
        } catch (err) {
            console.error(`[${EXTENSION_NAME}] 오류:`, err);
        } finally {
            isProcessing = false;
        }
    }

    // ===== 트리거 체크 =====
    async function checkTrigger(text, sensitivity, context) {
        if (sensitivity === 'high') return await aiTriggerCheck(text, context);
        const count = TRIGGER_PATTERNS.filter(p => text.includes(p)).length;
        return sensitivity === 'low' ? count >= 2 : count >= 1;
    }

    async function aiTriggerCheck(text, context) {
        try {
            const charName = context.name2 || '캐릭터';
            const { generateQuietPrompt } = SillyTavern.getContext();
            const prompt = `다음은 "${charName}"의 대화 메시지야:\n"${text}"\n이 메시지가 음악 카드를 띄울 만한 감성적인 상황이면 "yes", 아니면 "no"만 답해.`;
            const res = await generateQuietPrompt(prompt);
            return res?.toLowerCase().includes('yes') ?? false;
        } catch {
            return false;
        }
    }

    // ===== AI 음악 추천 =====
    async function requestMusic(text, context) {
        const { generateQuietPrompt } = SillyTavern.getContext();
        const charName = context.name2 || '캐릭터';
        const recentChat = (context.chat || [])
            .slice(-6)
            .map(m => `${m.is_user ? (context.name1 || 'User') : charName}: ${m.mes}`)
            .join('\n');

        const prompt = `다음은 "${charName}"와의 최근 대화야.
---
${recentChat}
---
이 분위기에서 "${charName}"가 듣고 있을 법한 실제 존재하는 곡 1개를 추천해줘.
반드시 아래 JSON 형식으로만 답해. 다른 텍스트 없이.
{"title":"곡제목","artist":"아티스트명","reason":"한줄이유15자이내"}`;

        try {
            const res = await generateQuietPrompt(prompt);
            if (!res) return null;
            const clean = res.replace(/```json|```/g, '').trim();
            const s = clean.indexOf('{');
            const e = clean.lastIndexOf('}');
            if (s === -1 || e === -1) return null;
            return JSON.parse(clean.slice(s, e + 1));
        } catch (err) {
            console.warn(`[${EXTENSION_NAME}] 파싱 실패:`, err);
            return null;
        }
    }

    // ===== YouTube 검색 =====
    async function searchYouTube(musicInfo, apiKey) {
        const q = encodeURIComponent(`${musicInfo.title} ${musicInfo.artist}`);
        const fallback = {
            videoId: null,
            watchUrl: `https://www.youtube.com/results?search_query=${q}`,
            thumbnail: null,
        };
        if (!apiKey) return fallback;

        try {
            const res = await fetch(
                `https://www.googleapis.com/youtube/v3/search` +
                `?part=snippet&q=${q}+official&type=video&maxResults=1&key=${apiKey}`
            );
            const data = await res.json();
            if (!data.items?.length) return fallback;
            const item = data.items[0];
            return {
                videoId: item.id.videoId,
                watchUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                thumbnail: item.snippet.thumbnails?.medium?.url || null,
            };
        } catch {
            return fallback;
        }
    }

    // ===== 전역: 카드 닫기 =====
    window._cmpClose = function (cardId) {
        $(`#${cardId}`).fadeOut(200, function () { $(this).remove(); });
    };

    // ===== 전역: YouTube 새 탭으로 열기 =====
    window._cmpOpen = function (url) {
        window.open(url, '_blank');
    };

    // ===== 카드 렌더링 =====
    function renderCard(musicInfo, videoInfo, messageId, context, style) {
        const charName = context.name2 || '캐릭터';
        const cardId   = `cmp-card-${Date.now()}`;
        const watchUrl = videoInfo?.watchUrl || '#';

        const closeBtn = `<button class="music-card-close" onclick="window._cmpClose('${cardId}')" title="닫기">✕</button>`;
        const playBtn  = `<button class="music-card-play"  onclick="window._cmpOpen('${escapeHtml(watchUrl)}')" title="YouTube에서 열기">▶</button>`;

        let card = '';

        if (style === 'text') {
            card = `
            <div class="music-card-wrapper" id="${cardId}">
                <div class="music-card-text">
                    <span class="music-card-text-icon">🎵</span>
                    <span class="music-card-text-info">
                        <b>${escapeHtml(musicInfo.title)}</b> — ${escapeHtml(musicInfo.artist)}
                        ${musicInfo.reason ? `<span class="music-card-text-reason">(${escapeHtml(musicInfo.reason)})</span>` : ''}
                    </span>
                    ${playBtn}
                    ${closeBtn}
                </div>
            </div>`;

        } else if (style === 'mini') {
            const thumb = videoInfo?.thumbnail;
            const thumbHtml = thumb
                ? `<img class="music-card-mini-thumb" src="${escapeHtml(thumb)}" />`
                : '<span class="music-card-mini-emoji">🎵</span>';

            card = `
            <div class="music-card-wrapper" id="${cardId}">
                <div class="music-card-mini">
                    ${thumbHtml}
                    <div class="music-card-mini-info">
                        <div class="music-card-mini-title">${escapeHtml(musicInfo.title)}</div>
                        <div class="music-card-mini-artist">${escapeHtml(musicInfo.artist)}</div>
                    </div>
                    ${playBtn}
                    ${closeBtn}
                </div>
            </div>`;

        } else {
            // ── 풀 카드 ──
            const thumb = videoInfo?.thumbnail;
            const thumbHtml = thumb
                ? `<img class="music-card-thumbnail" src="${escapeHtml(thumb)}" alt="album" />`
                : `<div class="music-card-thumbnail-placeholder">🎵</div>`;

            card = `
            <div class="music-card-wrapper" id="${cardId}">
                <div class="music-card">
                    ${thumbHtml}
                    <div class="music-card-info">
                        <div class="music-card-label">${escapeHtml(charName)} 듣는 중</div>
                        <div class="music-card-title">${escapeHtml(musicInfo.title)}</div>
                        <div class="music-card-artist">${escapeHtml(musicInfo.artist)}</div>
                        ${musicInfo.reason ? `<div class="music-card-artist" style="font-style:italic;opacity:0.55;margin-top:2px">${escapeHtml(musicInfo.reason)}</div>` : ''}
                    </div>
                    ${playBtn}
                    ${closeBtn}
                </div>
            </div>`;
        }

        // DOM 삽입
        const $mesText = $(`#chat .mes[mesid="${messageId}"] .mes_text`);
        const $mes     = $(`#chat .mes[mesid="${messageId}"]`);

        if ($mesText.length)     $mesText.after(card);
        else if ($mes.length)    $mes.append(card);
        else {
            const $last = $('#chat .mes:last .mes_text');
            if ($last.length)    $last.after(card);
            else                 $('#chat').append(card);
        }

        const chatEl = document.getElementById('chat');
        if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    initExtension();

})();
