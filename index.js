/**
 * Character Music 시그니처 Player
 * v2.1 - 확장 전용 커스텀 API & 모델 다이렉트 연동 기능 추가
 */

(async function () {
    const {
        eventSource,
        event_types,
        extensionSettings: extension_settings,
        saveSettingsDebounced,
    } = SillyTavern.getContext();

    const EXTENSION_NAME = 'character-music-player';

    // 🟢 커스텀 API를 위한 기본 설정값 추가
    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        youtubeApiKey: '',
        cooldownMinutes: 3,
        triggerSensitivity: 'medium',
        cardStyle: 'full',
        customApiProvider: 'main', // main, openrouter, gemini, openai, claude, custom
        customApiKey: '',
        customApiModel: '',
        customApiEndpoint: ''
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
        return s;
    }

    async function initExtension() {
        const s = getSettings();
        const htmlText = await $.get(`scripts/extensions/third-party/${EXTENSION_NAME}/settings.html`);
        const $html = $(htmlText);

        $('body').append($html.filter('#cmp-panel'));

        setTimeout(() => {
            const menuBtn = $html.filter('#cmp-open-btn-wrapper').html();
            $('#options').append(menuBtn);
            
            $('#cmp-open-btn').on('click', function (e) {
                e.stopPropagation();
                const panel = $('#cmp-panel');
                if (panel.hasClass('cmp-panel-open')) {
                    panel.removeClass('cmp-panel-open');
                } else {
                    panel.addClass('cmp-panel-open');
                    $('#options').hide();
                    $('#options_button').removeClass('active');
                    if ($(window).width() <= 800) {
                        $('#left-nav').removeClass('mobileslide');
                        $('.nav-overlay').click();
                    }
                }
            });
        }, 1000);

        $('#cmp-panel-close').on('click', () => $('#cmp-panel').removeClass('cmp-panel-open'));

        $(document).on('click', function(e) {
            if ($('#cmp-panel').hasClass('cmp-panel-open')) {
                if (!$(e.target).closest('#cmp-panel').length && !$(e.target).closest('#cmp-open-btn').length) {
                    $('#cmp-panel').removeClass('cmp-panel-open');
                }
            }
        });

        // 기본 UI 이벤트 바인딩
        $('#cmp-enabled').prop('checked', s.enabled).on('change', function () { getSettings().enabled = this.checked; saveSettingsDebounced(); });
        $('#cmp-apikey').val(s.youtubeApiKey || '').on('input', function () { getSettings().youtubeApiKey = this.value.trim(); saveSettingsDebounced(); });
        $('#cmp-cooldown').val(s.cooldownMinutes).on('input', function () { getSettings().cooldownMinutes = parseInt(this.value) || 3; saveSettingsDebounced(); });
        $('#cmp-sensitivity').val(s.triggerSensitivity).on('change', function () { getSettings().triggerSensitivity = this.value; saveSettingsDebounced(); });
        $('#cmp-cardstyle').val(s.cardStyle || 'full').on('change', function () { getSettings().cardStyle = this.value; saveSettingsDebounced(); });

        $('#cmp-help-toggle').on('click', () => $('#cmp-help-box').slideToggle(200));
        $('#cmp-ai-help-toggle').on('click', () => $('#cmp-ai-box').slideToggle(200));

        // 🟢 신규: 커스텀 API 설정 바인딩
        function toggleCustomFields(val) {
            if (val === 'main') {
                $('#cmp-custom-fields').hide();
            } else {
                $('#cmp-custom-fields').css('display', 'flex');
                if (val === 'custom') $('#cmp-api-endpoint').show();
                else $('#cmp-api-endpoint').hide();
            }
        }
        
        $('#cmp-api-provider').val(s.customApiProvider || 'main').on('change', function() {
            getSettings().customApiProvider = this.value;
            saveSettingsDebounced();
            toggleCustomFields(this.value);
        });
        $('#cmp-api-key').val(s.customApiKey).on('input', function() { getSettings().customApiKey = this.value.trim(); saveSettingsDebounced(); });
        $('#cmp-api-model').val(s.customApiModel).on('input', function() { getSettings().customApiModel = this.value.trim(); saveSettingsDebounced(); });
        $('#cmp-api-endpoint').val(s.customApiEndpoint).on('input', function() { getSettings().customApiEndpoint = this.value.trim(); saveSettingsDebounced(); });
        
        toggleCustomFields(s.customApiProvider || 'main');

        // 테스트 버튼
        $('#cmp-test-btn').on('click', async function () {
            const btn = $(this);
            btn.html('<i class="fa-solid fa-spinner fa-spin"></i> 추천 음악 생각 중...');
            btn.prop('disabled', true);
            
            const dummyPrompt = `이건 시스템 테스트야. 무조건 아래 JSON 형식으로만 답해.\n{"title":"테스트 곡 제목","artist":"테스트 가수","reason":"연결 성공!"}`;
            try {
                const resText = await getAiResponse(dummyPrompt);
                if (!resText) {
                    toastr.error("API 응답이 없거나 키/모델명이 잘못되었습니다.", "Music Player 오류");
                    return;
                }
                const parsed = parseJsonSafely(resText);
                if (!parsed) {
                    toastr.warning("AI가 JSON 형식을 지키지 않았습니다.", "Music Player 경고");
                    return;
                }
                toastr.success("연결 성공! UI를 띄웁니다.", "Music Player");
                renderCard(parsed, { watchUrl: "https://youtube.com", thumbnail: null }, { name2: "테스터" }, getSettings().cardStyle || 'full');
                $('#cmp-panel').removeClass('cmp-panel-open');
            } catch (error) {
                toastr.error("오류 발생! 콘솔창을 확인하세요.", "Music Player 오류");
            } finally {
                btn.html('<i class="fa-solid fa-play"></i> 음악 추천 & 카드 출력 테스트');
                btn.prop('disabled', false);
            }
        });

        if ($('#cmp-minimized-btn').length === 0) {
            $(document.body).append('<div id="cmp-minimized-btn"><i class="fa-solid fa-music"></i> 음악 펴기</div>');
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        console.log(`[${EXTENSION_NAME}] 로드 완료 v2.1.0 (다이렉트 커스텀 API 연동) ✅`);
    }

    // 🟢 [핵심] 독립된 API 통신 로직 (ST 메인망 완벽 우회)
    async function getAiResponse(prompt) {
        const s = getSettings();
        const provider = s.customApiProvider || 'main';

        // 1. ST 메인 API 사용
        if (provider === 'main') {
            const { generateQuietPrompt } = SillyTavern.getContext();
            try { return await generateQuietPrompt(prompt); } catch (e) { return null; }
        }

        // 2. 커스텀 API 다이렉트 호출
        const key = s.customApiKey;
        const model = s.customApiModel;
        
        if (!key || !model) {
            toastr.warning("확장 설정에서 커스텀 API Key와 모델명을 모두 입력해주세요.", "Music Player");
            return null;
        }

        try {
            // [Google Gemini]
            if (provider === 'gemini') {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.7 }
                    })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                return data.candidates[0].content.parts[0].text;
            }

            // [Anthropic Claude]
            if (provider === 'claude') {
                const url = 'https://api.anthropic.com/v1/messages';
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'x-api-key': key,
                        'anthropic-version': '2023-06-01',
                        'anthropic-dangerously-allow-browser': 'true', // 브라우저 CORS 우회 핵심
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        max_tokens: 300,
                        temperature: 0.7,
                        messages: [{ role: 'user', content: prompt }]
                    })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                return data.content[0].text;
            }

            // [OpenRouter, OpenAI, Custom (OAI 호환)]
            let endpoint = '';
            let headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            };

            if (provider === 'openrouter') {
                endpoint = 'https://openrouter.ai/api/v1/chat/completions';
                headers['HTTP-Referer'] = window.location.href;
                headers['X-Title'] = 'SillyTavern Music Player';
            } else if (provider === 'openai') {
                endpoint = 'https://api.openai.com/v1/chat/completions';
            } else if (provider === 'custom') {
                endpoint = s.customApiEndpoint;
                if (!endpoint) {
                    toastr.warning("커스텀 엔드포인트 URL을 입력해주세요.", "Music Player");
                    return null;
                }
            }

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7
                })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.choices[0].message.content;

        } catch (error) {
            console.error("[Music Player] Custom API Error:", error);
            toastr.error(`연결 실패: ${error.message}`, "Music Player API 오류");
            return null;
        }
    }

    function parseJsonSafely(text) {
        try {
            const clean = text.replace(/```json|```/gi, '').trim();
            const s = clean.indexOf('{');
            const e = clean.lastIndexOf('}');
            if (s === -1 || e === -1) return null;
            return JSON.parse(clean.slice(s, e + 1));
        } catch (e) { return null; }
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
            if (!musicInfo) return;
            
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
                const res = await getAiResponse(prompt);
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
            const res = await getAiResponse(prompt);
            if (!res) return null;
            return parseJsonSafely(res);
        } catch (err) { return null; }
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
        const thumb    = videoInfo?.thumbnail;

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
        $('#cmp-floating-container').fadeOut(200, function () {
            $('#cmp-minimized-btn').fadeIn(200);
        });
    });

    $(document).on('click', '.music-card-play', function () {
        const url = $(this).attr('data-url');
        if (url) window.open(url, '_blank');
    });

    $(document).on('click', '#cmp-minimized-btn', function () {
        $(this).fadeOut(200, function () {
            $('#cmp-floating-container').css('display', 'flex').hide().fadeIn(200);
        });
    });

    initExtension();
})();
