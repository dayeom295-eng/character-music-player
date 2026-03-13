/**
 * Character Music 시그니처 Player
 * v1.9
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
        cardStyle: 'full'
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

        // ✨ 플로팅 설정 패널을 body에 직접 주입
        const panelHtml = await $.get(`scripts/extensions/third-party/${EXTENSION_NAME}/settings.html`);
        $(document.body).append(panelHtml);

        // ✨ 확장 탭에는 최소한의 안내만 표시
        $('#extensions_settings').append(`
            <div style="padding:8px 0">
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>🎵 Character Music Player</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content" style="padding:10px 12px; font-size:12px; opacity:0.75; line-height:1.7">
                        입력창 옆 <b>🎵</b> 버튼을 눌러 설정을 여세요.<br>
                        <span style="opacity:0.6">v1.9 · Character Music Player</span>
                    </div>
                </div>
            </div>
        `);

        // ✨ 입력창 툴바에 🎵 버튼 주입
        // SillyTavern 버전별로 다른 셀렉터를 순서대로 시도
        if ($('#cmp-open-btn').length === 0) {
            const $btn = $('<button id="cmp-open-btn" title="Music Player 설정">🎵</button>');
            if ($('#leftSendMenu').length) {
                $('#leftSendMenu').append($btn);
            } else if ($('#options-bar').length) {
                $('#options-bar').prepend($btn);
            } else if ($('#send_form').length) {
                $('#send_form').prepend($btn);
            } else {
                $(document.body).append($btn.css({ position:'fixed', bottom:'20px', left:'16px', zIndex:2147483640 }));
            }
        }

        // UI 값 초기화
        $('#cmp-enabled').prop('checked', s.enabled);
        $('#cmp-apikey').val(s.youtubeApiKey || '');
        $('#cmp-cooldown').val(s.cooldownMinutes);
        $('#cmp-sensitivity').val(s.triggerSensitivity);
        $('#cmp-cardstyle').val(s.cardStyle || 'full');

        // 설정 저장
        $('#cmp-enabled').on('change', function () { getSettings().enabled = this.checked; saveSettingsDebounced(); });
        $('#cmp-apikey').on('input', function () { getSettings().youtubeApiKey = this.value.trim(); saveSettingsDebounced(); });
        $('#cmp-cooldown').on('input', function () { getSettings().cooldownMinutes = parseInt(this.value) || 3; saveSettingsDebounced(); });
        $('#cmp-sensitivity').on('change', function () { getSettings().triggerSensitivity = this.value; saveSettingsDebounced(); });
        $('#cmp-cardstyle').on('change', function () { getSettings().cardStyle = this.value; saveSettingsDebounced(); });

        // 패널 열기/닫기
        $(document).on('click', '#cmp-open-btn', function (e) {
            e.stopPropagation();
            $('#cmp-panel').toggleClass('cmp-panel-open');
        });
        $(document).on('click', '#cmp-panel-close', function () {
            $('#cmp-panel').removeClass('cmp-panel-open');
        });
        // 패널 바깥 클릭 시 닫기
        $(document).on('click', function (e) {
            if (!$(e.target).closest('#cmp-panel, #cmp-open-btn').length) {
                $('#cmp-panel').removeClass('cmp-panel-open');
            }
        });
        // 패널 내부 클릭은 전파 중단 (닫힘 방지)
        $(document).on('click', '#cmp-panel', function (e) {
            e.stopPropagation();
        });

        // 테스트 버튼
        $('#cmp-test-btn').on('click', async function () {
            toastr.info("AI 응답을 테스트 중입니다...", "Music Player");
            const dummyPrompt = `이건 시스템 테스트야. 무조건 아래 JSON 형식으로만 답해.\n{"title":"테스트 곡 제목","artist":"테스트 가수","reason":"연결 성공!"}`;
            try {
                const resText = await getAiResponse(dummyPrompt);
                if (!resText) {
                    toastr.error("API 응답이 없습니다. 실리태번 메인 API가 정상 연결되었는지 확인하세요.", "Music Player 오류");
                    return;
                }
                const parsed = parseJsonSafely(resText);
                if (!parsed) {
                    toastr.warning("API는 연결되었지만, AI가 JSON 형식을 지키지 않았습니다.", "Music Player 경고");
                    console.log("[CMP] AI 원본 응답:", resText);
                    return;
                }
                toastr.success("연결 완벽 성공! UI를 띄웁니다.", "Music Player");
                renderCard(parsed, { watchUrl: "https://youtube.com", thumbnail: null }, { name2: "테스터" }, getSettings().cardStyle || 'full');
                $('#cmp-panel').removeClass('cmp-panel-open');
            } catch (error) {
                toastr.error("오류 발생! F12 콘솔창을 확인하세요.", "Music Player 오류");
                console.error("[CMP] 테스트 버튼 오류:", error);
            }
        });

        // 최소화 버튼
        if ($('#cmp-minimized-btn').length === 0) {
            $(document.body).append('<div id="cmp-minimized-btn">🎵 음악 펴기</div>');
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        console.log(`[${EXTENSION_NAME}] 로드 완료 v1.9 ✅`);
    }

    async function getAiResponse(prompt) {
        const { generateQuietPrompt } = SillyTavern.getContext();
        try {
            return await generateQuietPrompt(prompt);
        } catch (e) {
            console.error("[CMP] API 호출 실패:", e);
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
