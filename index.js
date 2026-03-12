/**
 * Character Music 시그니처 Player
 * v1.8 — 전 기기 상단 고정 & 실시간 API 오류 알림/테스트 기능 추가
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
        geminiModel: 'gemini-1.5-flash-latest',
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
        const s = extension_settings[EXTENSION_NAME];
        for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
            if (!Object.hasOwn(s, k)) s[k] = v;
        }
        // ✨ 구버전 호환: geminiApiKey → apiKey 마이그레이션
        if (s.geminiApiKey && !s.apiKey) {
            s.apiKey = s.geminiApiKey;
            delete s.geminiApiKey;
            saveSettingsDebounced();
        }
        return s;
    }

    async function initExtension() {
        const s = getSettings();
        const settingsHtml = await $.get(`scripts/extensions/third-party/${EXTENSION_NAME}/settings.html`);
        $('#extensions_settings').append(settingsHtml);

        // UI 값 초기화
        $('#cmp-enabled').prop('checked', s.enabled);
        $('#cmp-apikey').val(s.youtubeApiKey || '');
        $('#cmp-cooldown').val(s.cooldownMinutes);
        $('#cmp-sensitivity').val(s.triggerSensitivity);
        $('#cmp-cardstyle').val(s.cardStyle || 'full');
        
        $('#cmp-api-provider').val(s.apiProvider || 'sillytavern');
        $('#cmp-gemini-model').val(s.geminiModel || 'gemini-1.5-flash-latest');
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

        // 설정 저장
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

        // ✨ 찐 API 통신 테스트 버튼
        $('#cmp-test-btn').on('click', async function () {
            toastr.info("API 연결을 테스트 중입니다...", "Music Player");
            
            const dummyPrompt = `이건 API 연결 테스트야. 무조건 아래 JSON 형식으로만 답해.\n{"title":"테스트 곡 제목","artist":"테스트 가수","reason":"연결 성공!"}`;
            
            try {
                const resText = await getAiResponse(dummyPrompt, true);
                if (!resText) {
                    toastr.error("API 응답이 없습니다. 설정(URL, 키, 모델명)을 확인하세요.", "Music Player 오류");
                    return;
                }
                
                const parsed = parseJsonSafely(resText);
                if (!parsed) {
                    toastr.warning("API는 연결되었지만, AI가 JSON 형식을 지키지 않았습니다.", "Music Player 경고");
                    console.log("[CMP] AI 원본 응답:", resText);
                    return;
                }

                toastr.success("API 연결 완벽 성공! UI를 띄웁니다.", "Music Player");
                renderCard(parsed, { watchUrl: "https://youtube.com", thumbnail: null }, {name2: "테스터"}, getSettings().cardStyle || 'full');

            } catch (error) {
                toastr.error("통신 오류 발생! F12 콘솔창을 확인하세요.", "Music Player 오류");
                console.error("[CMP] 테스트 버튼 오류:", error);
            }
        });

        if ($('#cmp-minimized-btn').length === 0) {
            $(document.body).append('<div id="cmp-minimized-btn">🎵 음악 펴기</div>');
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        console.log(`[${EXTENSION_NAME}] 로드 완료 v1.8 (API 실시간 디버깅 탑재) ✅`);
    }

    // 🚀 API 분기 처리
    async function getAiResponse(prompt, isJson = false) {
        const s = getSettings();
        if (s.apiProvider === 'gemini') {
            return await callGeminiAPI(prompt, isJson, s);
        } else if (s.apiProvider === 'custom') {
            return await callCustomOpenAI(prompt, isJson, s);
        } else {
            const { generateQuietPrompt } = SillyTavern.getContext();
            try { return await generateQuietPrompt(prompt); } catch { return null; }
        }
    }

    // 🤖 Gemini API 연결
    async function callGeminiAPI(prompt, isJson, s) {
        if (!s.apiKey) throw new Error("Gemini API 키가 입력되지 않았습니다.");
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${s.geminiModel}:generateContent?key=${s.apiKey}`;
        const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 200 } };
        if (isJson) payload.generationConfig.responseMimeType = "application/json";

        const res = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`Gemini HTTP Error: ${res.status}`);
        
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }

    // 🤖 OpenRouter / OpenAI 호환 API 연결 (가장 에러가 많은 부분)
    async function callCustomOpenAI(prompt, isJson, s) {
        if (!s.customUrl || !s.customModel || !s.apiKey) {
            throw new Error("Custom API 설정(URL, 모델명, 키) 중 누락된 것이 있습니다.");
        }
        
        // URL 끝 슬래시 제거 후, 베이스 URL이면 /chat/completions 자동 추가
        let cleanUrl = s.customUrl.replace(/\/$/, "");
        if (!cleanUrl.endsWith('/chat/completions') && !cleanUrl.endsWith('/completions')) {
            cleanUrl = cleanUrl + '/chat/completions';
        }

        const payload = { 
            model: s.customModel, 
            messages: [{ role: "user", content: prompt }], 
            temperature: 0.7, 
            max_tokens: 300
        };

        // ✨ JSON 모드 강제 — 모델이 JSON 이외의 텍스트를 반환하는 문제 방지
        if (isJson) {
            payload.response_format = { type: "json_object" };
        }

        const res = await fetch(cleanUrl, { 
            method: 'POST', 
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${s.apiKey}`,
                'HTTP-Referer': 'https://sillytavern.app', // OpenRouter 권장 헤더
                'X-Title': 'SillyTavern Music Player'
            }, 
            body: JSON.stringify(payload) 
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error(`[CMP] Custom API 실패 (${res.status}) URL: ${cleanUrl}`, errText);
            throw new Error(`Custom API HTTP Error: ${res.status} — ${errText.slice(0, 200)}`);
        }
        
        const data = await res.json();
        return data.choices?.[0]?.message?.content || null;
    }

    // 안전하게 JSON만 파싱해내는 함수
    function parseJsonSafely(text) {
        try {
            const clean = text.replace(/```json|```/gi, '').trim();
            const s = clean.indexOf('{');
            const e = clean.lastIndexOf('}');
            if (s === -1 || e === -1) return null;
            return JSON.parse(clean.slice(s, e + 1));
        } catch (e) {
            return null;
        }
    }

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

        const text = lastMsg.mes || '';
        const triggered = await checkTrigger(text, s.triggerSensitivity, context);
        if (!triggered) return;

        isProcessing = true;
        lastCardTime = now;

        try {
            const musicInfo = await requestMusic(text, context);
            if (!musicInfo) {
                console.warn("[CMP] AI가 곡 정보를 생성하지 못해 카드를 띄우지 않습니다.");
                return;
            }
            const videoInfo = await searchYouTube(musicInfo, s.youtubeApiKey);
            renderCard(musicInfo, videoInfo, context, s.cardStyle || 'full');
        } catch (err) {
            console.error(`[${EXTENSION_NAME}] 루프 오류:`, err);
        } finally {
            isProcessing = false;
        }
    }

    async function checkTrigger(text, sensitivity, context) {
        if (sensitivity === 'high') {
            try {
                const charName = context.name2 || '캐릭터';
                const prompt = `다음은 "${charName}"의 대화 메시지야:\n"${text}"\n이 메시지가 음악 카드를 띄울 만한 감성적인 상황이면 "yes", 아니면 "no"만 답해.`;
                const res = await getAiResponse(prompt, false);
                return res?.toLowerCase().includes('yes') ?? false;
            } catch { return false; }
        }
        const count = TRIGGER_PATTERNS.filter(p => text.toLowerCase().includes(p.toLowerCase())).length;
        return sensitivity === 'low' ? count >= 2 : count >= 1;
    }

    async function requestMusic(text, context) {
        const charName = context.name2 || '캐릭터';
        const recentChat = (context.chat || []).slice(-6).map(m => `${m.is_user ? (context.name1 || 'User') : charName}: ${m.mes}`).join('\n');
        
        const prompt = `다음은 나(User)와 "${charName}"와의 최근 대화야.
---
${recentChat}
---
[중요 지침]
1. 만약 대화 중에 유저나 캐릭터가 특정 곡 제목이나 아티스트를 명시하며 듣자고 했다면, 반드시 그 곡을 찾아줘.
2. 특정 곡 언급이 없다면, 현재 분위기와 감정에 맞는 실제 존재하는 곡 1개를 알아서 추천해.
반드시 아래 JSON 형식으로만 답해. 마크다운이나 다른 부가 설명은 절대 쓰지 마.
{"title":"곡제목","artist":"아티스트명","reason":"한줄이유15자이내"}`;

        try {
            const res = await getAiResponse(prompt, true);
            if (!res) return null;
            return parseJsonSafely(res);
        } catch (err) { 
            console.error("[CMP] 곡 요청 중 오류 발생:", err);
            return null; 
        }
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
            const reasonText = musicInfo.reason ? ` <span style="opacity:0.7; font-weight:normal;">(${escapeHtml(musicInfo.reason)})</span>` : '';
            card = `<div class="music-card-wrapper" id="${cardId}"><div class="music-card-ipod"><div class="ipod-icon">🎵</div><div class="ipod-screen"><marquee scrollamount="3" scrolldelay="0" class="ipod-marquee"><b>${escapeHtml(musicInfo.title)}</b> — ${escapeHtml(musicInfo.artist)} ${reasonText}</marquee></div>${controls}</div></div>`;
        } else if (style === 'text') {
            const reasonText = musicInfo.reason ? ` <span style="opacity:0.6; font-weight:normal;">(${escapeHtml(musicInfo.reason)})</span>` : '';
            card = `<div class="music-card-wrapper" id="${cardId}"><div class="music-card-airpods"><div class="airpods-icon">🎧</div><div class="airpods-screen"><marquee scrollamount="3" scrolldelay="0" class="airpods-marquee"><b>${escapeHtml(musicInfo.title)}</b> — ${escapeHtml(musicInfo.artist)} ${reasonText}</marquee></div>${controls}</div></div>`;
        } else if (style === 'mini') {
            const thumbHtml = thumb ? `<img class="lp-cover" src="${escapeHtml(thumb)}" />` : `<div class="lp-cover placeholder">🎵</div>`;
            card = `<div class="music-card-wrapper" id="${cardId}"><div class="music-card-lp"><div class="lp-container">${thumbHtml}<div class="lp-hole"></div></div><div class="lp-info"><div class="lp-title">${escapeHtml(musicInfo.title)}</div><div class="lp-artist">${escapeHtml(musicInfo.artist)}</div></div>${controls}</div></div>`;
        } else {
            const thumbHtml = thumb ? `<img class="music-card-thumbnail" src="${escapeHtml(thumb)}" />` : `<div class="music-card-thumbnail-placeholder">🎵</div>`;
            card = `<div class="music-card-wrapper" id="${cardId}"><div class="music-card">${thumbHtml}<div class="music-card-info"><div class="music-card-label">${escapeHtml(charName)} 듣는 중</div><div class="music-card-title">${escapeHtml(musicInfo.title)}</div><div class="music-card-artist">${escapeHtml(musicInfo.artist)}</div>${musicInfo.reason ? `<div class="music-card-artist" style="font-style:italic;opacity:0.55;margin-top:2px">${escapeHtml(musicInfo.reason)}</div>` : ''}</div>${controls}</div></div>`;
        }

        if ($('#cmp-floating-container').length === 0) {
            $(document.body).append('<div id="cmp-floating-container" style="display:none;"></div>');
        }
        
        $('#cmp-minimized-btn').hide();
        $('#cmp-floating-container').html(card).css('display', 'flex').hide().fadeIn(300);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    $(document).on('click', '.music-card-close', function () {
        const cardId = $(this).attr('data-id');
        $(`#${cardId}`).fadeOut(200, function () { $(this).remove(); }); 
        $('#cmp-minimized-btn').hide(); 
        $('#cmp-floating-container').hide();
    });

    $(document).on('click', '.music-card-minimize', function () {
        $('#cmp-floating-container').fadeOut(200, function() {
            $('#cmp-minimized-btn').fadeIn(200);
        });
    });

    $(document).on('click', '.music-card-play', function () {
        const url = $(this).attr('data-url');
        if (url) window.open(url, '_blank');
    });

    $(document).on('click', '#cmp-minimized-btn', function () {
        $(this).fadeOut(200, function() {
            $('#cmp-floating-container').css('display', 'flex').hide().fadeIn(200);
        });
    });

    initExtension();
})();
