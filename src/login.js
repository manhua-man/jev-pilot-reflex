import "./login.css";

const button = document.getElementById("continue");
const error = document.getElementById("auth-error");
if (new URLSearchParams(location.search).has("error")) {
  error.textContent = "Sign-in could not be completed. Please try again.";
  error.hidden = false;
  history.replaceState(null, "", "/login");
}
document.getElementById("signup").addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = "Opening secure sign-in…";
  error.hidden = true;
  try {
    const response = await fetch("/api/auth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        early_access: document.getElementById("early-access").checked,
      }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || "Sign-in is unavailable. Please try again.",
      );
    location.assign(data.url);
  } catch (cause) {
    error.textContent = cause.message;
    error.hidden = false;
    button.disabled = false;
    button.textContent = "Continue with Standard Agents ↗";
  }
});
fetch("/api/status")
  .then((r) => r.json())
  .then((data) => {
    if (data.auth_required === false || data.authenticated)
      location.replace("/");
  })
  .catch(() => {});
