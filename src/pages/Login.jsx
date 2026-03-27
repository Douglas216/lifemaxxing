import React, { useEffect, useState } from "react";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth, db } from "../firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");
  const [sendingReset, setSendingReset] = useState(false);
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  // Redirect if already logged in
  useEffect(() => {
    if (!loading && user) {
      navigate("/");
    }
  }, [user, loading, navigate]);

  // 📌 Email Login
  async function handleLogin() {
    try {
      setErrorMsg("");
      setInfoMsg("");
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setErrorMsg(err.message);
    }
  }

  // 📌 Google Login (also handles sign-up automatically)
  async function handleGoogleLogin() {
    try {
      setErrorMsg("");
      setInfoMsg("");
      const provider = new GoogleAuthProvider();

      const result = await signInWithPopup(auth, provider);
      const googleUser = result.user;

      // Check if Firestore doc exists
      const userRef = doc(db, "users", googleUser.uid);
      const snap = await getDoc(userRef);

      // If first time login → create user document
      if (!snap.exists()) {
        await setDoc(userRef, {
          email: googleUser.email,
          createdAt: serverTimestamp(),
        });
      }

      navigate("/");
    } catch (err) {
      console.error(err);
      setErrorMsg("Google login failed. Please try again.");
    }
  }

  async function handleForgotPassword() {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setInfoMsg("");
      setErrorMsg("Enter your email first, then click Forgot password?");
      return;
    }

    try {
      setSendingReset(true);
      setErrorMsg("");
      await sendPasswordResetEmail(auth, trimmedEmail);
      setInfoMsg("If that account exists, a password reset email has been sent.");
    } catch (err) {
      setErrorMsg(err.message);
      setInfoMsg("");
    } finally {
      setSendingReset(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Log In</h1>

        {/* Email input */}
        <input
          type="email"
          placeholder="Email"
          style={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        {/* Password input */}
        <input
          type="password"
          placeholder="Password"
          style={styles.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          type="button"
          style={styles.linkButton}
          onClick={handleForgotPassword}
          disabled={sendingReset}
        >
          {sendingReset ? "Sending reset email..." : "Forgot password?"}
        </button>

        {/* Login button */}
        <button style={styles.button} onClick={handleLogin}>
          Log In
        </button>

        {/* Google Login Button */}
        <button style={styles.googleButton} onClick={handleGoogleLogin}>
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="Google"
            style={styles.googleIcon}
          />
          Continue with Google
        </button>

        {infoMsg && <p style={styles.info}>{infoMsg}</p>}

        {/* Error message */}
        {errorMsg && <p style={styles.error}>{errorMsg}</p>}
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #f7f9fc, #e8efff)",
    padding: "20px",
  },
  card: {
    width: "100%",
    maxWidth: "380px",
    background: "white",
    padding: "32px",
    borderRadius: "20px",
    boxShadow: "0 8px 25px rgba(0, 0, 0, 0.08)",
    textAlign: "center",
  },
  title: {
    fontSize: "28px",
    fontWeight: "600",
    marginBottom: "24px",
  },
  input: {
    width: "100%",
    padding: "12px 16px",
    margin: "8px 0",
    borderRadius: "12px",
    border: "1px solid #d0d7e2",
    fontSize: "16px",
  },
  linkButton: {
    padding: 0,
    marginTop: "6px",
    marginLeft: "auto",
    display: "block",
    background: "transparent",
    border: "none",
    color: "#2d57ff",
    fontSize: "14px",
    cursor: "pointer",
  },
  button: {
    width: "100%",
    padding: "14px 16px",
    marginTop: "12px",
    background: "#2d57ff",
    color: "white",
    fontSize: "17px",
    fontWeight: "500",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
  },

  // Google button
  googleButton: {
    width: "100%",
    padding: "12px 16px",
    marginTop: "16px",
    background: "white",
    border: "1px solid #dadce0",
    borderRadius: "12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: "500",
    color: "#444",
    gap: "10px",
  },
  googleIcon: {
    width: "20px",
    height: "20px",
  },
  info: {
    marginTop: "12px",
    color: "#2563eb",
    fontSize: "14px",
  },
  error: {
    marginTop: "12px",
    color: "red",
    fontSize: "14px",
  },
};
