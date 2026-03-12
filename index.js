/**
 * Character Music Player Extension for SillyTavern
 * v1.7 — 하단 플로팅 고정 & 4가지 디자인 모드 (에어팟, 레트로 포함)
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
        '위로','힐링','추억','에어팟','스피커','오디오','재생','뮤직',
        'music','song','melody','rhythm','humming','listening to','play a track','playlist','earphones','headphones','bgm',
        'piano','guitar','playing','sing','dancing','vibe','dawn','sunset','raining','driving','walking','cafe',
        'comfort','healing','crying','tears','longing','memories','airpods','speaker','audio','mp3','track','tune',
        'acoustic','jazz','pop','rock','classical','sad','happy','angry','lonely','nostalgic',
        '音楽','歌','曲','メロディ','リズム','鼻歌','聴いて','かけて','プレイリスト','イヤホン','ヘッドホン','BGM',
        'ピアノ','ギター','演奏','歌う','踊る','エモい','夜明け','夕暮れ','雨','ドライブ','散歩','カフェ',
        '慰め','癒し','涙','泣く','恋しい','思い出','スピーカー','オーディオ','再生','トラック','チューン',
        '怒','悲','泣','嬉','寂','切ない','懐かしい'
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

        // ✨ 4번 레트로 옵션 동적 추가 및 이름 직관적 변경
        if ($('#cmp-cardstyle option[value="retro"]').length === 0) {
            $('#cmp-cardstyle').append('<option value="retro">4. 레트로 (앨범아트 안 보임)</option>');
        }
        $('#cmp-cardstyle option[value="full"]').text('1. 풀카드 (앨범아트 보임)');
        $('#cmp-cardstyle option[value="mini"]').text('2. LP판 (앨범아트 보임)');
        $('#cmp-cardstyle option[value="text"]').text('3. 에어팟 (앨범아트 안 보임)');

        const aiUI = `
            <div class="flex-container flexFlowColumn" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--SmartThemeBorderColor);">
                <div style="margin-bottom: 10px;"><b>🤖 음악 추천용 전용 AI 설정</b></div>
                
                <label for="cmp-api-provider"><b>연결할 API 선택</b></label>
                <select id="cmp-api-provider" class="text_pole" style="margin-bottom: 15px;">
                    <option value="sillytavern">실리태번 메인 API (자동)</option>
                    <option value="gemini">Google Gemini API</option>
                    <option value="custom">타사 API (OpenRouter, OpenAI 등)</option>
                </select>

                <div id="cmp-gemini-wrap" class="flex-container flexFlowColumn" style="display: none; padding-left: 10px; border-left: 3px solid var(--SmartThemeBlurTintColor);">
                    <label for="cmp-gemini-model">Gemini 모델</label>
                    <select id="cmp-gemini-model" class="text_pole" style="margin-bottom: 10px;">
                        <option value="gemini-1.5-flash-latest">Gemini 1.5 Flash</option>
                        <option value="gemini-1.5-pro-latest">Gemini 1.5 Pro</option>
                        <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash</option>
                        <option value="gemini-2.5-pro-latest">Gemini 2.5 Pro</option>
                        <option value="gemini-3.0-flash-latest">Gemini 3.0 Flash</option>
                    </select>
                </div>

                <div id="cmp-custom-wrap" class="flex-container flexFlowColumn" style="display: none; padding-left: 10px; border-left: 3px solid var(--SmartThemeBlurTintColor);">
                    <label for="cmp-custom-url">API 엔드포인트 URL</label>
                    <input id="cmp-custom-url" type="text" class="text_pole" placeholder="예: https://openrouter.ai/api/v1/chat/completions" style="margin-bottom: 10px;">
                    <label for="cmp-custom-model">모델명</label>
                    <input id="cmp-custom-model" type="text" class="text_pole" placeholder="예: gpt-4o-mini" style="margin-bottom: 10px;">
                </div>

                <div id="cmp-key-wrap" class="flex-container flexFlowColumn" style="display: none; padding-left: 10px; margin-top: 5px;">
                    <label for="cmp-api-key">API Key</label>
                    <input id="cmp-api-key" type="password" class="text_pole" placeholder="해당 플랫폼의 발급 키 입력">
                </div>
            </div>
        `;
        
        $(`#extensions_settings .inline-drawer-content`).last().append(aiUI);

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

        $('#cmp-enabled').on('change', function () { getSettings().enabled = this.checked; saveSettingsDebounced(); });
        $('#cmp-apikey').on('input', function () { getSettings().youtubeApiKey = this.value.trim(); saveSettingsDebounced(); });
        $('#cmp-cooldown').on('input', function () { getSettings().cooldownMinutes = parseInt(this.value) || 3; saveSettingsDebounced(); });
        $('#cmp-sensitivity').on('change', function () { getSettings().triggerSensitivity = this.value; saveSettingsDebounced(); });
        $('#cmp-cardstyle').on('change', function () { getSettings().cardStyle = this.value; saveSettingsDebounced(); });
        
        $('#cmp-api-provider').on('change', function () { getSettings().apiProvider = this.value; saveSettingsDebounced(); updateAiUi(); });
        $('#cmp-gemini-model').on('change', function () { getSettings().geminiModel = this.value; saveSettingsDebounced(); });
        $('#cmp-custom-url').on('input', function () { getSettings().customUrl = this.value.trim(); saveSettingsDebounced(); });
        $('#cmp-custom-model').on('input', function () { getSettings().customModel = this.value.trim(); saveSettingsDebounced(); });
        $('#cmp-api-key').on('input', function () { getSettings().apiKey = this.value.trim(); saveSettingsDebounced(); });

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        console.log(`[${EXTENSION_NAME}] 로드 완료 v1.7 (하단 플로팅 & 레트로 추가) ✅`);
    }

    async function getAiResponse(prompt, isJson = false) {
        const s = getSettings();
        if (s.apiProvider === 'gemini') return await callGeminiAPI(prompt, isJson, s);
        else if (s.apiProvider === 'custom') return await callCustomOpenAI(prompt, isJson, s);
        else {
            const { generateQuietPrompt } = SillyTavern.getContext();
            try { return await generateQuietPrompt(prompt); } catch (err) { return null; }
        }
    }

    async function callGeminiAPI(prompt, isJson, s) {
        if (!s.apiKey) return null;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${s.geminiModel}:generateContent?key=${s.apiKey}`;
        const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 200 } };
        if (isJson) payload.generationConfig.responseMimeType = "application/json";
        try {
            const res = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await res.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
        } catch { return null; }
    }

    async function callCustomOpenAI(prompt, isJson, s) {
        if (!s.customUrl || !s.customModel || !s.apiKey) return null;
        const payload = { model: s.customModel, messages: [{ role: "user", content: prompt }], temperature: 0.7, max_tokens: 200 };
        if (isJson) payload.response_format = { type: "json_object" };
        try {
            const res = await fetch(s.customUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s.apiKey}` }, body: JSON.stringify(payload) });
            const data = await res.json();
            return data.choices?.[0]?.message?.content || null;
        } catch { return null; }
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
            console.error(`[${EXTENSION_NAME}] 오류:`, err);
        } finally {
            isProcessing = false;
        }
    }

    async function checkTrigger(text, sensitivity, context) {
        if (sensitivity === 'high') return await aiTriggerCheck(text, context);
        const count = TRIGGER_PATTERNS.filter(p => text.toLowerCase().includes(p.toLowerCase())).length;
        return sensitivity === 'low' ? count >= 2 : count >= 1;
    }

    async function aiTriggerCheck(text, context) {
        try {
            const charName = context.name2 || '캐릭터';
            const prompt = `다음은 "${charName}"의 대화 메시지야:\n"${text}"\n이 메시지가 음악 카드를 띄울 만한 감성적인 상황이면 "yes", 아니면 "no"만 답해.`;
            const res = await getAiResponse(prompt, false);
            return res?.toLowerCase().includes('yes') ?? false;
        } catch { return false; }
    }

    async function requestMusic(text, context) {
        const charName = context.name2 || '캐릭터';
        const recentChat = (context.chat || []).slice(-6).map(m => `${m.is_user ? (context.name1 || 'User') : charName}: ${m.mes}`).join('\n');
        const prompt = `다음은 "${charName}"와의 최근 대화야.\n---\n${recentChat}\n---\n이 분위기에서 "${charName}"가 듣고 있을 법한 실제 존재하는 곡 1개를 추천해줘.\n반드시 아래 JSON 형식으로만 답해.\n{"title":"곡제목","artist":"아티스트명","reason":"한줄이유15자이내"}`;

        try {
            const res = await getAiResponse(prompt, true);
            if (!res) return null;
            const clean = res.replace(/```json|```/g, '').trim();
            const s = clean.indexOf('{');
            const e = clean.lastIndexOf('}');
            if (s === -1 || e === -1) return null;
            return JSON.parse(clean.slice(s, e + 1));
        } catch { return null; }
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

    window._cmpClose = function (cardId) { $(`#${cardId}`).fadeOut(200, function () { $(this).remove(); }); };
    window._cmpOpen = function (url) { window.open(url, '_blank'); };

    // ✨ 렌더링 방식 완전히 교체 (하단 고정 컨테이너)
    function renderCard(musicInfo, videoInfo, context, style) {
        const charName = context.name2 || '캐릭터';
        const cardId   = `cmp-card-${Date.now()}`;
        const watchUrl = videoInfo?.watchUrl || '#';
        const thumb = videoInfo?.thumbnail;

        const closeBtn = `<button class="music-card-close" onclick="window._cmpClose('${cardId}')" title="닫기">✕</button>`;
        const playBtn  = `<button class="music-card-play" onclick="window._cmpOpen('${escapeHtml(watchUrl)}')" title="YouTube에서 열기">▶</button>`;

        let card = '';

        if (style === 'retro') {
            // ✨ 4. 부활한 레트로 아이팟 전광판 디자인
            const reasonText = musicInfo.reason ? ` <span style="opacity:0.7; font-weight:normal;">(${escapeHtml(musicInfo.reason)})</span>` : '';
            card = `
            <div class="music-card-wrapper" id="${cardId}">
                <div class="music-card-ipod">
                    <div class="ipod-icon">🎵</div>
                    <div class="ipod-screen">
                        <marquee scrollamount="3" scrolldelay="0" class="ipod-marquee">
                            <b>${escapeHtml(musicInfo.title)}</b> — ${escapeHtml(musicInfo.artist)} ${reasonText}
                        </marquee>
                    </div>
                    ${playBtn}
                    ${closeBtn}
                </div>
            </div>`;
        } else if (style === 'text') {
            // 3. 에어팟 위젯 
            const reasonText = musicInfo.reason ? ` <span style="opacity:0.6; font-weight:normal;">(${escapeHtml(musicInfo.reason)})</span>` : '';
            card = `
            <div class="music-card-wrapper" id="${cardId}">
                <div class="music-card-airpods">
                    <div class="airpods-icon">🎧</div>
                    <div class="airpods-screen">
                        <marquee scrollamount="3" scrolldelay="0" class="airpods-marquee">
                            <b>${escapeHtml(musicInfo.title)}</b> — ${escapeHtml(musicInfo.artist)} ${reasonText}
                        </marquee>
                    </div>
                    ${playBtn}
                    ${closeBtn}
                </div>
            </div>`;
        } else if (style === 'mini') {
            // 2. LP판 
            const thumbHtml = thumb ? `<img class="lp-cover" src="${escapeHtml(thumb)}" />` : `<div class="lp-cover placeholder">🎵</div>`;
            card = `
            <div class="music-card-wrapper" id="${cardId}">
                <div class="music-card-lp">
                    <div class="lp-container">
                        ${thumbHtml}
                        <div class="lp-hole"></div>
                    </div>
                    <div class="lp-info">
                        <div class="lp-title">${escapeHtml(musicInfo.title)}</div>
                        <div class="lp-artist">${escapeHtml(musicInfo.artist)}</div>
                    </div>
                    ${playBtn}
                    ${closeBtn}
                </div>
            </div>`;
        } else {
            // 1. 풀카드
            const thumbHtml = thumb ? `<img class="music-card-thumbnail" src="${escapeHtml(thumb)}" />` : `<div class="music-card-thumbnail-placeholder">🎵</div>`;
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

        // ✨ 화면 하단 전용 컨테이너 생성 및 삽입 (채팅창 스크롤과 무관하게 입력창 위 고정)
        if ($('#cmp-floating-container').length === 0) {
            $('body').append('<div id="cmp-floating-container"></div>');
        }
        
        // 새 노래가 켜지면 이전 노래는 지우고 새로 갈아끼웁니다
        $('#cmp-floating-container').html(card);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    initExtension();
})();
