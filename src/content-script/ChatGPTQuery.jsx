import { useEffect, useState } from 'preact/hooks'
import PropTypes from 'prop-types'
import ReactMarkdown from 'react-markdown'
import Browser from 'webextension-polyfill'
const port = Browser.runtime.connect()
let setAnswerCb;
let setErrorCb;
const listener = (msg) => {
  console.debug("content script received msg", msg);
  switch (msg.type) {
    case "cmd":
      switch (msg.cmd) {
        case "reload":
          location.reload();
          break;
        default:
          break;
      }
      break;
    default:
      if (msg.answer) {
        if (setAnswerCb) {
          setAnswerCb(msg);
          // setAnswerCb = undefined;
        }
      } else if (msg.error === 'UNAUTHORIZED') {
        if (setErrorCb) {
          setErrorCb('UNAUTHORIZED');
          // setErrorCb = undefined;
        }
      } else {
        if (setErrorCb) {
          setErrorCb('EXCEPTION');
          // setErrorCb = undefined;
        }
      }
      break;
  }
}
port.onMessage.addListener(listener)

if (window.location == "https://chat.openai.com/chat") {
  let ti = setInterval(() => {
    let elements = document.querySelector('#__NEXT_DATA__');
    if (elements) {
      port.postMessage({ type: "cmd", cmd: "logined", location: window.location});
      clearInterval(ti);
    }
    console.log("elements", elements);
  }, 1000);
  
}

function ChatGPTQuery(props) {
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    setAnswerCb = (msg) => {
      setAnswer('**ChatGPT:**\n\n' + msg.answer);
    }
    setErrorCb = (msg) => {
      setError(msg)
    }
    console.log("ChatGPTQuery post", props.question);
    port.postMessage({ question: props.question, location: window.location })
    return () => {
      // port.onMessage.removeListener(listener)
      // port.disconnect()
    }
  }, [props.question])

  if (answer) {
    return (
      <div id="answer" className="markdown-body gpt-inner" dir="auto">
        <ReactMarkdown>{answer}</ReactMarkdown>
      </div>
    )
  }

  if (error === 'UNAUTHORIZED') {
    return (
      <p className="gpt-inner">
        Please login at{' '}
        <a href="https://chat.openai.com" target="_blank" rel="noreferrer">
          chat.openai.com
        </a>{' '}
        first
      </p>
    )
  }
  if (error) {
    return <p className="gpt-inner">Failed to load response from ChatGPT</p>
  }

  return <p className="gpt-loading gpt-inner">Waiting for ChatGPT response...</p>
}

ChatGPTQuery.propTypes = {
  question: PropTypes.string.isRequired,
}

export default ChatGPTQuery
