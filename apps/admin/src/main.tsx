import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { StudioPrototype } from "./prototype/StudioPrototype";
import { AdminApp } from "./admin/AdminApp";

const showStudioPrototype = new URLSearchParams(window.location.search).get("prototype") === "studio";
const showLegacyStudio = import.meta.env.VITE_APP_MODE === "studio"
  || new URLSearchParams(window.location.search).get("mode") === "studio";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {showStudioPrototype ? <StudioPrototype /> : showLegacyStudio ? <App /> : <AdminApp />}
  </React.StrictMode>
);
