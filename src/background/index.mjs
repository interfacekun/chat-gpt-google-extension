import ExpiryMap from 'expiry-map'
import {
    v4 as uuidv4
} from 'uuid'
import Browser from 'webextension-polyfill'
import {
    fetchSSE
} from './fetch-sse.mjs'

let send

const KEY_ACCESS_TOKEN = 'accessToken'

const cache = new ExpiryMap(10 * 1000)

async function getAccessToken() {
    if (cache.get(KEY_ACCESS_TOKEN)) {
        return cache.get(KEY_ACCESS_TOKEN)
    }
    const resp = await fetch('https://chat.openai.com/api/auth/session')
        .then((r) => r.json())
        .catch(() => ({}))
    if (!resp.accessToken) {
        throw new Error('UNAUTHORIZED')
    }
    cache.set(KEY_ACCESS_TOKEN, resp.accessToken)
    return resp.accessToken
}

async function generateAnswers(port, question) {
    const accessToken = await getAccessToken()

    const controller = new AbortController()
    port.onDisconnect.addListener(() => {
        controller.abort()
    })

    await fetchSSE('https://chat.openai.com/backend-api/conversation', {
        method: 'POST',
        signal: controller.signal,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            action: 'next',
            messages: [{
                id: uuidv4(),
                role: 'user',
                content: {
                    content_type: 'text',
                    parts: [question],
                },
            }, ],
            model: 'text-davinci-002-render',
            parent_message_id: uuidv4(),
        }),
        onMessage(message) {
            console.debug('sse message', message)
            if (message === '[DONE]') {
                return
            }
            const data = JSON.parse(message)
            const text = data.message?.content?.parts?.[0]
            if (text) {
                port.postMessage({
                    answer: text
                })
            }
        },
    })
}

let CMD = {}
let states = {
    msgId: uuidv4(),
    conversation_id: undefined
};

CMD.logined = () => {
    Browser.storage.sync.get("msgid").then((result) => {
        console.log("msgid", result);
        if (result != undefined && result["msgid"]) {
            states.msgId = result["msgid"];
        }
    });
    
    Browser.storage.sync.get("cid").then((result) => {
        console.log("conversation_id", result);
        if (result != undefined && result["cid"]) {
            states.conversation_id = result["cid"];
        }
    });

    console.log("init done");
}


async function  getChatgptReply(question) {
    return new Promise(async (resolve) => {
        let accessToken;
        try {
            accessToken = await getAccessToken()
        } catch (error) {
            resolve("哇哦😮，登录过期，请重新登录");
        }
        
        const controller = new AbortController()
        let response = "";

        let msg = {
            action: 'next',
            messages: [{
                id: uuidv4(),
                role: 'user',
                content: {
                    content_type: 'text',
                    parts: [question],
                },
            }, ],
            model: 'text-davinci-002-render',
            parent_message_id: states.msgId,
        }

        if (states.conversation_id != undefined) {
            msg.conversation_id = states.conversation_id;
        }

        try {
            await fetchSSE('https://chat.openai.com/backend-api/conversation', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },

            body: JSON.stringify(msg),
            onMessage(message) {
                if (message === '[DONE]') {
                    resolve(response);
                    Browser.storage.sync.set({"msgid": states.msgId});
                    Browser.storage.sync.set({"cid": states.conversation_id});
                    return
                }
                const data = JSON.parse(message)
                console.debug('sse message', data)
                const text = data.message?.content?.parts?.[0]
                if (text) {
                    response = text;
                }
                const id = data.message?.id
                if (id) {
                    states.msgId = id;
                  
                }
                const cid = data.conversation_id
                if (cid) {
                    states.conversation_id = cid;
                }
            },
            })
        } catch (error) {
            console.error("fetchSSE error", error);
            resolve(response + "。\n哇哦😯，网络超时，请重试");
            return;
        }
    })
    
}

Browser.runtime.onConnect.addListener((port) => {
    console.debug("onConnect", port.name);
    port.onMessage.addListener(async (msg) => {
        console.debug('backgroud received msg', msg)
        switch (msg.type) {
            case "cmd":
                console.log("cmd", msg);
                let handler = CMD[msg.cmd];
                if (handler) {
                    handler(msg);
                }
                break;
            default:
                try {
                    await generateAnswers(port, msg.question)
                } catch (err) {
                    console.error(err)
                    port.postMessage({
                        error: err.message
                    })
                    cache.delete(KEY_ACCESS_TOKEN)
                }
                break;
        }
    })
})



function initWsClient() {
    let states = {
        connectd: false,
        heartbeat: undefined,
        reqId: 0,
        callbacks: [], 
        heartbeatTime: Date.now(),
    }
    // 打开一个 web socket
    let ws = new WebSocket("ws://192.168.82.186:8081");
    
    ws.onopen = function () {
        // // Web Socket 已连接上，使用 send() 方法发送数据
        // ws.send("发送数据");
        // alert("数据发送中...");
        console.log("ws onopen");
        states.connectd = true;
        states.reqId = 0;
        states.callbacks = [];
        send = (msg, cb) => {
            if (msg.id == undefined) {
                states.reqId++;
                msg.id = states.reqId;
            }
            if (cb) {
                states.callbacks[states.reqId] = cb;
            }
            ws.send(JSON.stringify(msg));
            if (states.reqId > 10000) {
                states.reqId  = 10000;
            }
        }
        states.heartbeat = setInterval(() => {
            send({type: 0, content: "ping"});
            if (Date.now() - states.heartbeatTime > 30000) {
                clearInterval(states.heartbeat);
                initWsClient();
            }
        }, 10000);
    };

    ws.onmessage = (evt) => {
        // var received_msg = evt.data;
        // alert("数据已接收...");
        console.log("ws onmessage", evt.data);
        let msg = JSON.parse(evt.data);
        states.heartbeatTime = Date.now();
        if (msg.type == 1) {
            if (states.callbacks[msg.id]) {
                states.callbacks[msg.id](msg);
            }
        } else {
            getChatgptReply(msg.content).then((response) => {
                msg.content = response;
                msg.type = 1;
                send(msg);
            })
        }
    };

    ws.onclose =  () => {
        // 关闭 websocket
        // alert("连接已关闭...");
        console.log("ws onclose");
        setTimeout(() => {
            initWsClient();
        }, 5000);
        
    };

    ws.onerror = (evt) => {
        console.error("ws connected error", evt);
    }

    // setTimeout(() => {
    //     if (!states.connectd) {
    //         console.error("ws connected timeout");
    //         initWsClient();
    //     }
    // }, 5000);
}

initWsClient();