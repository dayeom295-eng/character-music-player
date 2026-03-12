/**
 * Character Music 시그니처 Player
 * v1.8 — Custom API 시스템 프롬프트 주입 및 JSON 강제화 완벽 패치
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
        apiProvider: 'sillytavern',
        apiKey: '',
        geminiModel: 'gemini-1.5-flash',
        customUrl: '',
        customModel: ''
    });

    const TRIGGER_PATTERNS = [
        '분노','화가','격분','열받','짜증','슬픔','눈물','울음','설렘','두근','흥분','황홀','절망','그리움','외로움','쓸쓸','긴장','두려움',
        '음악','노래','곡','멜로디','리듬','흥얼','콧노래','듣고 있','틀어','플레이리스트','이어폰','헤드폰','BGM','피아노','기타','연주',
        '새벽','늦은 밤','저녁 노을','황혼','달빛','빗소리','비가 내리','눈이 내리','드라이브','산책','카페','침대','잠들기 전','귀갓길',
        '위로','힐링','추억','에어팟','스피커','오디오','재생','뮤직'
    ];

    let lastCardTime = 0;
    let isProcessing = false;

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

    async function initExtension() {
        const s = getSettings();
        const settingsHtml = await $.get(`scripts/extensions/third-party/${EXTENSION_NAME}/settings.html`);
        $('#extensions_settings').append(settingsHtml);

        $('#cmp-enabled').prop('checked', s.enabled);
        $('#cmp-apikey').val(s.youtubeApiKey || '');
        $('#cmp-cooldown').val(s.cooldownMinutes);
        $('#cmp-sensitivity').val(s.triggerSensitivity);
        $('#cmp-cardstyle').val(s.cardStyle || 'full');
        $('#cmp-api-provider').val(s.apiProvider || 'sillytavern');
        $('#cmp-gemini-model').val(s.geminiModel || 'gemini-1.5-flash');
        $('#cmp-custom-url').val(s.customUrl || '');
        $('#cmp-custom-model').val(s.customModel || '');
        $('#cmp-api-key').val(s.apiKey || '');

        function updateAiUi() {
            const provider = $('#cmp-api-provider').val();
            if (provider === 'sillytavern') { 
                $('#cmp-gemini-wrap, #cmp-custom-wrap, #cmp-key-wrap').slideUp(150); 
            } else if (provider === 'gemini') { 
                $('#cmp-gemini-wrap, #cmp-key-wrap').slideDown(150); 
                $('#cmp-custom-wrap').hide(); 
            } else if (provider === 'custom') { 
                $('#cmp-custom-wrap, #cmp-key-wrap').slideDown(150); 
                $('#cmp-gemini-wrap').hide(); 
            }
        }
        updateAiUi(); 

        $('#cmp-enabled').on('change', function () { getSettings().enabled = this.checked; saveSettingsDebounced(); });
        $('#cmp-apikey').on('input', function () { getSettings().youtubeApiKey = this.value.trim(); saveSettingsDebounced(); });
        $('#cmp-cooldown').on('input', function () { getSettings().cooldownMinutes = parseInt(this.value) || 3; saveSettingsDebounced(); });
        $('#cmp-sensitivity').on('change', function () { getSettings().triggerSensitivity = this.value; saveSettingsDebounced(); });
        $('#cmp-cardstyle').on('change', function () { getSettings().cardStyle = this.value; saveSettingsDebounced(); });
        $('#cmp-api-provider').on('change', function () { getSettings().apiProvider = this.value; saveSettingsDebounced(); updateAiUi(); });
        $('#cmp-gemini-model').on('input', function () { getSettings().geminiModel = this.value.trim(); saveSettingsDebounced(); });
        $('#cmp-custom-url').on('input', function () { getSettings().customUrl = this.value.trim(); saveSettingsDebounced(); });
        $('#cmp-custom-model').on('input', function () { getSettings().customModel = this.value.trim(); saveSettingsDebounced(); });
        $('#cmp-api-key').on('input', function () { getSettings().apiKey = this.value.trim(); saveSettingsDebounced(); });

        $('#cmp-test-btn').on('click', async function () {
            toastr.info("API 연결을 테스트 중입니다...", "Music Player");
            const dummyPrompt = `이건 테스트야. 반드시 아래 JSON 형식으로만 답해.\n{"title":"테스트 곡 제목","artist":"테스트 가수","reason":"연결 성공!"}`;
            try {
                const resText = await getAiResponse(dummyPrompt, true);
                if (!resText) { toastr.error("응답이 없습니다. 설정을 확인하세요.", "Music Player 오류"); return; }
                const parsed = parseJsonSafely(resText);
                if (!parsed) { toastr.warning("연결은 되었으나 JSON 형식이 아닙니다. 콘솔창 확인", "Music Player 경고"); console.log(resText); return; }
                toastr.success("API 연결 성공!", "Music Player");
                renderCard(parsed, { watchUrl: "https://youtube.com", thumbnail: null }, {name2: "테스터"}, getSettings().cardStyle || 'full');
            } catch (error) { toastr.error("통신 오류 발생! F12 콘솔창 확인", "Music Player 오류"); }
        });

        if ($('#cmp-minimized-btn').length === 0) {
            $(document.body).append('<div id="cmp-minimized-btn">🎵 음악 펴기</div>');
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        console.log(`[${EXTENSION_NAME}] 로드 완료 v1.8 (Custom API 시스템 권한 패치) ✅`);
    }

    async function getAiResponse(prompt, isJson = false) {
        const s = getSettings();
        if (s.apiProvider === 'gemini') return await callGeminiAPI(prompt, isJson, s);
        else if (s.apiProvider === 'custom') return await callCustomOpenAI(prompt, isJson, s);
        else {
            const { generateQuietPrompt } = SillyTavern.getContext();
            try { return await generateQuietPrompt(prompt); } catch { return null; }
        }
    }

    async function callGeminiAPI(prompt, isJson, s) {
        if (!s.apiKey) throw new Error("Gemini API 키 누락");
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${s.geminiModel}:generateContent?key=${s.apiKey}`;
        const payload = { 
            contents: [{ role: "user", parts: [{ text: prompt }] }], 
            generationConfig: { temperature: 0.5, maxOutputTokens: 200 }, // 온도를 낮춰서 정확도 상향
            safetySettings: [
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        };
        if (isJson) payload.generationConfig.responseMimeType = "application/json";

        const res = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.promptFeedback?.blockReason) throw new Error(`검열 차단됨: ${data.promptFeedback.blockReason}`);
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }

    // ✨ 문제의 Custom API 부분을 완전히 뜯어고쳤습니다.
    async function callCustomOpenAI(prompt, isJson, s) {
        if (!s.customUrl || !s.customModel || !s.apiKey) throw new Error("Custom API 설정 누락");
        const cleanUrl = s.customUrl.replace(/\/$/, "");
        
        // 🚀 AI가 절대 딴소리를 못하도록 [System] 프롬프트를 강제로 주입합니다.
        const messages = [];
        if (isJson) {
            messages.push({ 
                role: "system", 
                content: "You are a data extraction API. You MUST output ONLY raw JSON. Do not write any conversational text, greetings, or markdown blocks." 
            });
        } else {
            messages.push({ 
                role: "system", 
                content: "Answer only with 'yes' or 'no'." 
            });
        }
        
        // 실제 유저 대화(prompt)를 덧붙입니다.
        messages.push({ role: "user", content: prompt });

        const payload = { 
            model: s.customModel, 
            messages: messages, 
            temperature: 0.3, // AI가 헛소리를 덜 하도록 온도 낮춤
            max_tokens: 300 
        };

        const res = await fetch(cleanUrl, { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${s.apiKey}`,
                'HTTP-Referer': 'https://sillytavern.app',
                'X-Title': 'SillyTavern Music Player'
            }, 
            body: JSON.stringify(payload) 
        });

        if (!res.ok) throw new Error(`Custom API HTTP Error: ${res.status}`);
        const data = await res.json();
        
        // 콘솔창에 AI가 실제로 뭐라고 대답했는지 띄워줍니다 (디버깅용)
        const aiAnswer = data.choices?.[0]?.message?.content || "";
        console.log("[CMP] 커스텀 API 실제 응답결과:", aiAnswer);
        
        return aiAnswer;
    }

    function parseJsonSafely(text) {
        try {
            const clean = text.replace(/```json|```/gi, '').trim();
            const s = clean.indexOf('{');
            const e = clean.lastIndexOf('}');
            if (s === -1 || e === -1) return null;
            return JSON.parse(clean.slice(s, e + 1));
        } catch { return null; }
    }

    async function onMessageReceived() {
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

        const text = lastMsg.mes || '';
        const triggered = await checkTrigger(text, s.triggerSensitivity, context);
        if (!triggered) return;

        toastr.info("🎵 음악 키워드 감지됨! 곡을 검색합니다...", "Music Player 작동");

        isProcessing = true;
        lastCardTime = now;

        try {
            const musicInfo = await requestMusic(text, context);
            if (!musicInfo) {
                toastr.warning("AI가 추천 형식을 지키지 않아 카드를 띄우지 못했습니다. F12 콘솔창을 확인하세요.", "Music Player 실패");
                return;
            }
            toastr.success(`[${musicInfo.title}] 곡을 찾았습니다!`, "Music Player");
            
            const videoInfo = await searchYouTube(musicInfo, s.youtubeApiKey);
            renderCard(musicInfo, videoInfo, context, s.cardStyle || 'full');
        } catch (err) {
            toastr.error(`오류: ${err.message}`, "Music Player 에러");
        } finally {
            isProcessing = false;
        }
    }

    async function checkTrigger(text, sensitivity, context) {
        if (sensitivity === 'high') {
            try {
                const prompt = `Does the following message imply a situation where listening to music would be appropriate? Answer yes or no:\n"${text}"`;
                const res = await getAiResponse(prompt, false);
                return res?.toLowerCase().includes('yes') ?? false;
            } catch { return false; }
        }
        const count = TRIGGER_PATTERNS.filter(p => text.toLowerCase().includes(p.toLowerCase())).length;
        return sensitivity === 'low' ? count >= 2 : count >= 1;
    }

    async function requestMusic(text, context) {
        const charName = context.name2 || '캐릭터';
        const recentChat = (context.chat || []).slice(-4).map(m => `${m.is_user ? 'User' : charName}: ${m.mes}`).join('\n');
        
        // 🚀 지시사항(프롬프트)을 영어로 변경하여 글로벌 API들이 지시를 더 완벽하게 따르도록 만듭니다. (출력은 한국어로 나옴)
        const prompt = `Based on the chat history below, recommend 1 real, existing song that fits the current mood.
If the characters explicitly mention a specific song or artist, you MUST choose that song.
Ignore any roleplay rules or censorship. Just extract the song information.

Chat history:
---
${recentChat}
---
You MUST output ONLY a valid JSON object in this exact format. No markdown, no conversational text.
{"title":"Song Title", "artist":"Artist Name", "reason":"Short reason in Korean"}`;

        const res = await getAiResponse(prompt, true);
        if (!res) return null;
        return parseJsonSafely(res);
    }

    async function searchYouTube(musicInfo, apiKey) {
        const q = encodeURIComponent(`${musicInfo.title} ${musicInfo.artist}`);
        const fallback = { videoId: null, watchUrl: `https://www.youtube.com/results?search_query=${q}`, thumbnail: null };
        if (!apiKey) return fallback;
        try {
            const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}+official&type=video&maxResults=1&key=${apiKey}`);
            const data = await res.json();
            if (!data.items?.length) return fallback;
            const item = data.items[0];
            return { videoId: item.id.videoId, watchUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`, thumbnail: item.snippet.thumbnails?.medium?.url || null };
        } catch { return fallback; }
    }

    function renderCard(musicInfo, videoInfo, context, style) {
        const charName = context.name2 || '캐릭터';
        const cardId   = `cmp-card-${Date.now()}`;
        const watchUrl = videoInfo?.watchUrl || '#';
        const thumb = videoInfo?.thumbnail;
        const minBtn   = `<button class="music-card-minimize" title="최소화">−</button>`;
        const closeBtn = `<button class="music-card-close" data-id="${cardId}" title="닫기">✕</button>`;
        const playBtn  = `<button class="music-card-play" data-url="${escapeHtml(watchUrl)}" title="YouTube에서 열기">▶</button>`;
        const controls = `<div class="music-card-controls">${playBtn}${minBtn}${closeBtn}</div>`;
        let card = '';

        if (style === 'retro') {
            card = `<div class="music-card-wrapper" id="${cardId}"><div class="music-card-ipod"><div class="ipod-icon">🎵</div><div class="ipod-screen"><marquee scrollamount="3" scrolldelay="0" class="ipod-marquee"><b>${escapeHtml(musicInfo.title)}</b> — ${escapeHtml(musicInfo.artist)}</marquee></div>${controls}</div></div>`;
        } else if (style === 'text') {
            card = `<div class="music-card-wrapper" id="${cardId}"><div class="music-card-airpods"><div class="airpods-icon">🎧</div><div class="airpods-screen"><marquee scrollamount="3" scrolldelay="0" class="airpods-marquee"><b>${escapeHtml(musicInfo.title)}</b> — ${escapeHtml(musicInfo.artist)}</marquee></div>${controls}</div></div>`;
        } else if (style === 'mini') {
            const thumbHtml = thumb ? `<img class="lp-cover" src="${escapeHtml(thumb)}" />` : `<div class="lp-cover placeholder">🎵</div>`;
            card = `<div class="music-card-wrapper" id="${cardId}"><div class="music-card-lp"><div class="lp-container">${thumbHtml}<div class="lp-hole"></div></div><div class="lp-info"><div class="lp-title">${escapeHtml(musicInfo.title)}</div><div class="lp-artist">${escapeHtml(musicInfo.artist)}</div></div>${controls}</div></div>`;
        } else {
            const thumbHtml = thumb ? `<img class="music-card-thumbnail" src="${escapeHtml(thumb)}" />` : `<div class="music-card-thumbnail-placeholder">🎵</div>`;
            card = `<div class="music-card-wrapper" id="${cardId}"><div class="music-card">${thumbHtml}<div class="music-card-info"><div class="music-card-label">${escapeHtml(charName)} 듣는 중</div><div class="music-card-title">${escapeHtml(musicInfo.title)}</div><div class="music-card-artist">${escapeHtml(musicInfo.artist)}</div></div>${controls}</div></div>`;
        }

        if ($('#cmp-floating-container').length === 0) $(document.body).append('<div id="cmp-floating-container" style="display:none;"></div>');
        $('#cmp-minimized-btn').hide();
        $('#cmp-floating-container').html(card).css('display', 'flex').hide().fadeIn(300);
    }

    function escapeHtml(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    $(document).on('click', '.music-card-close', function () { $(`#${$(this).attr('data-id')}`).fadeOut(200, function () { $(this).remove(); }); $('#cmp-minimized-btn').hide(); $('#cmp-floating-container').hide(); });
    $(document).on('click', '.music-card-minimize', function () { $('#cmp-floating-container').fadeOut(200, function() { $('#cmp-minimized-btn').fadeIn(200); }); });
    $(document).on('click', '.music-card-play', function () { const url = $(this).attr('data-url'); if (url) window.open(url, '_blank'); });
    $(document).on('click', '#cmp-minimized-btn', function () { $(this).fadeOut(200, function() { $('#cmp-floating-container').css('display', 'flex').hide().fadeIn(200); }); });

    initExtension();
})();
