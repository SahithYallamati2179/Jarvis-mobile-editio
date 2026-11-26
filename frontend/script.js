/* ==========================================
   1. API KEY & MODEL CONFIGURATION
========================================== */

let API_KEY = localStorage.getItem('jarvis_key');

if (!API_KEY) {
    API_KEY = prompt('Enter your Gemini API Key:');

    if (API_KEY) {
        localStorage.setItem('jarvis_key', API_KEY);
    }
}

const MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-flash-latest"
];


/* ==========================================
   2. MEMORY SYSTEM
========================================== */

let MEMORY = [];

try {
    MEMORY = JSON.parse(
        localStorage.getItem('jarvis_memory') || '[]'
    );
} catch (e) {
    MEMORY = [];
}

function saveMemory() {
    localStorage.setItem(
        'jarvis_memory',
        JSON.stringify(MEMORY)
    );
}


/* ==========================================
   3. HTML ELEMENTS
========================================== */

const chat = document.getElementById('chat');
const input = document.getElementById('msg');
const micBtn = document.getElementById('mic-btn');
const clearBtn = document.getElementById('clear-btn');
const camBtn = document.getElementById('cam-btn');
const imgInput = document.getElementById('img-input');
const sendBtn = document.getElementById('send');


/* ==========================================
   4. DISPLAY SAVED MEMORY
========================================== */

MEMORY.forEach(m => {
    add(
        (m.role === 'user' ? 'YOU: ' : 'J.A.R.V.I.S: ') + m.text,
        m.role === 'user' ? 'user' : 'ai'
    );
});


/* ==========================================
   5. GEMINI BRAIN
========================================== */

async function callGemini(promptText) {

    const contents = MEMORY.slice(-12).map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
    }));

    contents.push({
        role: 'user',
        parts: [{ text: promptText }]
    });

    let lastErr;

    for (const model of MODELS) {

        try {

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: contents
                    })
                }
            );

            const data = await res.json();

            if (!res.ok || data.error) {

                const message =
                    data.error?.message || `HTTP ${res.status}`;

                lastErr = new Error(message);

                // Try the next model only for model availability
                // or temporary server / rate-limit errors.
                if (
                    res.status === 429 ||
                    res.status === 503 ||
                    res.status === 500 ||
                    /high demand|temporar|quota|rate|unavailable|deprecated/i.test(message)
                ) {
                    continue;
                }

                throw lastErr;
            }

            const reply = data.candidates?.[0]?.content?.parts
                ?.map(part => part.text || '')
                .join('');

            if (!reply) {
                throw new Error('Gemini returned an empty response.');
            }

            return reply;

        } catch (e) {
            lastErr = e;
        }
    }

    throw lastErr || new Error('All Gemini models failed.');
}


/* ==========================================
   6. ASK J.A.R.V.I.S.
========================================== */

async function askGemini(promptText) {

    const thinkingMsg = add(
        'J.A.R.V.I.S: Thinking...',
        'ai'
    );

    try {

        const reply = await callGemini(promptText);

        MEMORY.push({
            role: 'user',
            text: promptText
        });

        MEMORY.push({
            role: 'model',
            text: reply
        });

        saveMemory();

        thinkingMsg.innerText = 'J.A.R.V.I.S: ' + reply;

        speak(reply);

    } catch (e) {

        thinkingMsg.innerText =
            'J.A.R.V.I.S: ERROR - ' + e.message;

    }
}


/* ==========================================
   7. IMAGE / VISION ENGINE
========================================== */

if (camBtn && imgInput) {

    camBtn.onclick = () => imgInput.click();

    imgInput.onchange = () => {

        const file = imgInput.files?.[0];

        if (!file) return;

        if (!file.type.startsWith('image/')) {
            add('SYSTEM: Please select an image file.', 'ai');
            imgInput.value = '';
            return;
        }

        const reader = new FileReader();

        reader.onload = () => {

            const base64 = reader.result.split(',')[1];

            const question =
                input.value.trim() ||
                'What do you see? Describe briefly.';

            add('YOU: [IMAGE] ' + question, 'user');

            input.value = '';

            askVision(base64, file.type, question);

        };

        reader.readAsDataURL(file);
    };
}


async function askVision(base64, mime, question) {

    const thinkingMsg = add(
        'J.A.R.V.I.S: Analyzing image...',
        'ai'
    );

    let lastErr;

    for (const model of MODELS) {

        try {

            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{
                            role: 'user',
                            parts: [
                                { text: question },
                                {
                                    inline_data: {
                                        mime_type: mime,
                                        data: base64
                                    }
                                }
                            ]
                        }]
                    })
                }
            );

            const data = await res.json();

            if (!res.ok || data.error) {

                const message =
                    data.error?.message || `HTTP ${res.status}`;

                lastErr = new Error(message);

                if (
                    res.status === 429 ||
                    res.status === 503 ||
                    res.status === 500 ||
                    /high demand|temporar|quota|rate|unavailable|deprecated/i.test(message)
                ) {
                    continue;
                }

                throw lastErr;
            }

            const reply = data.candidates?.[0]?.content?.parts
                ?.map(part => part.text || '')
                .join('');

            if (!reply) {
                throw new Error('Gemini returned an empty response.');
            }

            thinkingMsg.innerText = 'J.A.R.V.I.S: ' + reply;

            speak(reply);

            return;

        } catch (e) {
            lastErr = e;
        }
    }

    thinkingMsg.innerText =
        'J.A.R.V.I.S: ERROR - ' +
        (lastErr?.message || 'Image analysis failed.');
}


/* ==========================================
   8. VOICE INPUT
========================================== */

const SR =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

if (SR && micBtn) {

    const rec = new SR();

    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;

    rec.onresult = (e) => {

        const text = e.results[0][0].transcript;

        add('YOU: ' + text, 'user');

        askGemini(text);
    };

    rec.onerror = (e) => {

        add(
            'SYSTEM: Voice error - ' + e.error,
            'ai'
        );

    };

    micBtn.onclick = () => {

        try {
            rec.start();
            micBtn.innerText = 'LISTENING...';
        } catch (e) {
            add('SYSTEM: Microphone is already active.', 'ai');
        }

    };

    rec.onend = () => {
        micBtn.innerText = '🎤';
    };

}


/* ==========================================
   9. VOICE OUTPUT
========================================== */

let voices = [];

function loadVoices() {
    voices = speechSynthesis.getVoices();
}

loadVoices();

speechSynthesis.onvoiceschanged = loadVoices;


function speak(text) {

    if (!window.speechSynthesis) return;

    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.rate = 1.05;
    utterance.pitch = 0.85;

    const voice = voices.find(v =>
        v.lang.startsWith('en')
    );

    if (voice) {
        utterance.voice = voice;
    }

    speechSynthesis.speak(utterance);
}


/* ==========================================
   10. SEND BUTTON
========================================== */

if (sendBtn && input) {

    sendBtn.onclick = () => {

        const text = input.value.trim();

        if (!text) return;

        add('YOU: ' + text, 'user');

        input.value = '';

        askGemini(text);
    };

}


/* ==========================================
   11. ENTER KEY TO SEND
========================================== */

if (input) {

    input.addEventListener('keydown', (e) => {

        if (e.key === 'Enter' && !e.shiftKey) {

            e.preventDefault();

            sendBtn?.click();

        }

    });

}


/* ==========================================
   12. CLEAR MEMORY
========================================== */

if (clearBtn) {

    clearBtn.onclick = () => {

        MEMORY = [];

        saveMemory();

        chat.innerHTML = '';

        speechSynthesis.cancel();

        add('SYSTEM: Memory cleared.', 'ai');

    };

}


/* ==========================================
   13. MESSAGE DISPLAY FUNCTION
========================================== */

function add(text, who) {

    const div = document.createElement('div');

    div.className = 'msg ' + who;

    div.innerText = text;

    chat.appendChild(div);

    chat.scrollTop = chat.scrollHeight;

    return div;
}
