import ReactDOM from 'react-dom'

import './index.css'

import { DB } from './data'
import App from './App'


const db = new DB()

ReactDOM.render(
  <App db={db} />,
  document.getElementById('root')
)
