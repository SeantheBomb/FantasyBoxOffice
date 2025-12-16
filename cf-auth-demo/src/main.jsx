import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import Signup from "./pages/Signup.jsx";
import Login from "./pages/Login.jsx";
import Me from "./pages/Me.jsx";

function Layout({ children }) {
  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <Link to="/signup">Signup</Link>{" | "}
        <Link to="/login">Login</Link>{" | "}
        <Link to="/me">Me</Link>
      </header>
      {children}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout><Navigate to="/me" replace /></Layout>} />
        <Route path="/signup" element={<Layout><Signup /></Layout>} />
        <Route path="/login" element={<Layout><Login /></Layout>} />
        <Route path="/me" element={<Layout><Me /></Layout>} />
        <Route path="*" element={<Layout><div>Not found</div></Layout>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
