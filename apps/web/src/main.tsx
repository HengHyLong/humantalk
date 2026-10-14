import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { StudioPrototype } from "./prototype/StudioPrototype";
import { ExhibitSurveyPage } from "./components/ExhibitSurveyPage";
import { FrontendAccessGate } from "./components/FrontendAccessGate";
import { RemoteQuestionPage } from "./components/RemoteQuestionPage";

const showStudioPrototype = new URLSearchParams(window.location.search).get("prototype") === "studio";
const surveyToken = window.location.pathname.match(/^\/survey\/([^/]+)\/?$/)?.[1] || "";
const remoteQuestionToken = new URLSearchParams(window.location.search).get("ask") || "";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {remoteQuestionToken ? <RemoteQuestionPage token={remoteQuestionToken} /> : surveyToken ? <ExhibitSurveyPage token={decodeURIComponent(surveyToken)} /> : <FrontendAccessGate>{showStudioPrototype ? <StudioPrototype /> : <App />}</FrontendAccessGate>}
  </React.StrictMode>
);
