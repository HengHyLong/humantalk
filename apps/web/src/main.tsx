import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { StudioPrototype } from "./prototype/StudioPrototype";
import { ExhibitSurveyPage } from "./components/ExhibitSurveyPage";

const showStudioPrototype = new URLSearchParams(window.location.search).get("prototype") === "studio";
const surveyToken = window.location.pathname.match(/^\/survey\/([^/]+)\/?$/)?.[1] || "";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {surveyToken ? <ExhibitSurveyPage token={decodeURIComponent(surveyToken)} /> : showStudioPrototype ? <StudioPrototype /> : <App />}
  </React.StrictMode>
);
