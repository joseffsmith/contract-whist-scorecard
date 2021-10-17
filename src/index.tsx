import ReactDOM from 'react-dom'
import { BrowserRouter as Router } from 'react-router-dom'

import { Root } from './App'

import './index.css'

ReactDOM.render(
  <Router>
    <Root />
  </Router>,
  document.getElementById('root')
)
