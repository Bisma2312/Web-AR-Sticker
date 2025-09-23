document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("loginForm");
  const errorMsg = document.getElementById("error");

  const togglePassword = document.getElementById("togglePassword");
  const passwordInput = document.getElementById("passwordInput");

  togglePassword.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";

    // Tambahkan animasi aktif
    togglePassword.classList.toggle("active");

    // Ubah ikon
    togglePassword.textContent = isPassword ? "⌣" : "👁";
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const username = document.getElementById("email").value.trim();
    const password = document.getElementById("passwordInput").value.trim();
    const now = new Date();
    // Dummy check
    if (username === "admin@lenovo.co.id" && password === "Rechargeroom@lenovo") {
      const item = {
        value : "tokenauth" + Date.now(),
        expired : now.getDate()
      };
      localStorage.setItem("token", JSON.stringify(item));

      // redirect ke halaman utama (misal index.html / viewer.html)
      window.location.href = "index.html";
    } else {
      errorMsg.style.display = "block";
    }
  });
});
