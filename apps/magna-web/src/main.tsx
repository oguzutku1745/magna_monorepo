import "./lib/browser-polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AuthorizePage } from "./AuthorizePage";
import "./styles.css";

const Root = window.location.pathname === "/authorize" ? AuthorizePage : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
