import ReactDOM from 'react-dom'
import './index.css'
import App from './App'


import { DB } from './data'

const db = new DB()
ReactDOM.render(
  <React.StrictMode>
    <App db={db} />
  </React.StrictMode>,
  document.getElementById('root')
)
