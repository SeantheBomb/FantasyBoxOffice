import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./Layout.jsx";
import { UserProvider } from "./useUser.jsx";
import Home from "./pages/Home.jsx";
import Signup from "./pages/Signup.jsx";
import Login from "./pages/Login.jsx";
import Me from "./pages/Me.jsx";
import Standings from "./pages/Standings.jsx";
import Catalog from "./pages/Catalog.jsx";
import AuctionsBrowse from "./pages/AuctionsBrowse.jsx";
import AuctionDetail from "./pages/AuctionDetail.jsx";
import MyMovies from "./pages/MyMovies.jsx";
import MovieDetail from "./pages/MovieDetail.jsx";
import Admin from "./pages/Admin.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <UserProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/login" element={<Login />} />
            <Route path="/me" element={<Me />} />
            <Route path="/standings" element={<Standings />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/auctions" element={<AuctionsBrowse />} />
            <Route path="/auctions/:id" element={<AuctionDetail />} />
            <Route path="/my-movies" element={<MyMovies />} />
            <Route path="/movie/:tmdbId" element={<MovieDetail />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<div>Not found</div>} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </UserProvider>
  </React.StrictMode>
);
