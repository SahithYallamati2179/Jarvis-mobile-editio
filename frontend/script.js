/* ==========================================
   1. API KEY & MODEL CONFIGURATION (GROQ)
========================================== */

let API_KEY = localStorage.getItem('jarvis_groq_key');

if (!API_KEY) {
    API_KEY = prompt('Enter your Groq API Key:');
    if (API_KEY) localStorage.setItem('jarvis_groq_key', API_KEY);
}

// Text models: fallback is attempted if a model is unavailable.
const TEXT_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b"
];

// Vision model (supports image input).
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";


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
   5. GROQ BRAIN
========================================== */

async function callGroq(promptText) {

    const messages = MEMORY.slice(-12).map(m => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.text
    }));

    messages.push({
        role: 'user',
        content: promptText
    });

    let lastErr;

    for (const model of TEXT_MODELS) {

        try {

            const res = await fetch(GROQ_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: 0.7
                })
            });

            const data = await res.json();

            if (!res.ok) {

                const message =
                    data.error?.message || `HTTP ${res.status}`;

                lastErr = new Error(message);

                // Retry the next model for model-related
                // or temporary failures.
                if (
                    res.status === 429 ||
                    res.status === 503 ||
                    res.status === 500 ||
                    /model|temporar|rate|limit|unavailable|decommission/i.test(message)
                ) {
                    continue;
                }

                throw lastErr;
            }

            const reply = data.choices?.[0]?.message?.content;

            if (!reply) {
                throw new Error('Groq returned an empty response.');
            }

            return reply;

        } catch (e) {
            lastErr = e;
        }
    }

    throw lastErr || new Error('All Groq text models failed.');
}


/* ==========================================
   6. ASK J.A.R.V.I.S.
========================================== */

async function askGroq(promptText) {

    const thinkingMsg = add(
        'J.A.R.V.I.S: Thinking...',
        'ai'
    );

    try {

        const reply = await callGroq(promptText);

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
   7. IMAGE / VISION ENGINE (GROQ)
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

    try {

        const res = await fetch(GROQ_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: VISION_MODEL,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: question },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:${mime};base64,${base64}`
                            }
                        }
                    ]
                }]
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(
                data.error?.message || `HTTP ${res.status}`
            );
        }

        const reply = data.choices?.[0]?.message?.content;

        if (!reply) {
            throw new Error('Groq returned an empty image response.');
        }

        thinkingMsg.innerText = 'J.A.R.V.I.S: ' + reply;

        speak(reply);

    } catch (e) {

        thinkingMsg.innerText =
            'J.A.R.V.I.S: ERROR - ' + e.message;

    }
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

        askGroq(text);

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

        askGroq(text);

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


/* ==========================================
   14. SYSTEM STATUS MONITOR
========================================== */

function updateStatus(id, active, text) {

    const element = document.getElementById(id);

    if (!element) return;

    element.className = active ? 'on' : 'off';

    element.innerText = active
        ? '● ' + text
        : '● ' + text;
}


// AI CORE
updateStatus('ai-status', !!API_KEY, API_KEY ? 'READY' : 'NO KEY');


// NETWORK
updateStatus(
    'network-status',
    navigator.onLine,
    navigator.onLine ? 'ONLINE' : 'OFFLINE'
);


// VOICE
const voiceInputAvailable =
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

const voiceOutputAvailable =
    !!window.speechSynthesis;

const voiceAvailable =
    voiceInputAvailable && voiceOutputAvailable;

updateStatus(
    'voice-status',
    voiceAvailable,
    voiceAvailable ? 'ONLINE' : 'PARTIAL / OFFLINE'
);


// MEMORY
let memoryAvailable = false;

try {
    localStorage.setItem('jarvis_test', '1');
    localStorage.removeItem('jarvis_test');
    memoryAvailable = true;
} catch (e) {
    memoryAvailable = false;
}

updateStatus(
    'memory-status',
    memoryAvailable,
    memoryAvailable ? 'ONLINE' : 'OFFLINE'
);


// NETWORK CHANGES
window.addEventListener('online', () => {
    updateStatus('network-status', true, 'ONLINE');
});

window.addEventListener('offline', () => {
    updateStatus('network-status', false, 'OFFLINE');
});
