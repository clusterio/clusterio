import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import Layout from './layout'
import * as serviceWorker from './serviceWorker';
import { BrowserRouter } from 'react-router-dom';

import moment from "moment";
import locale from "moment/locale/nb";

moment.updateLocale("nb", locale);
// ReactDOM.render(
//   <React.StrictMode>
//     <Layout />
//   </React.StrictMode>,
//   document.getElementById('root')
// );

ReactDOM.render(
  <BrowserRouter>
  <Layout />
  </BrowserRouter>,
  document.getElementById('root')
)

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
