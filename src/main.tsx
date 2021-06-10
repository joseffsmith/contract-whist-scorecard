import { StrictMode } from 'react'
import ReactDOM from 'react-dom'

import './index.css'

import { DB } from './data'
import App from './App'


const db = new DB()

ReactDOM.render(
  <StrictMode>
    <App db={db} />
  </StrictMode>,
  document.getElementById('root')
)
