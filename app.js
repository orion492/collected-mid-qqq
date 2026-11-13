
/* Collected Mid QQQ Configuration */

const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_KEY = "YOUR_SUPABASE_PUBLISHABLE_KEY";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const FUNCTION_URL =
  SUPABASE_URL + "/functions/v1/view-pdf";


/* HOME: Published Documents */

async function loadDocuments() {
  const container = document.getElementById("documents");

  const { data, error } = await supabaseClient
    .from("documents")
    .select("id,title,description")
    .eq("is_published", true)
    .order("created_at", { ascending: false });

  if (error) {
    container.textContent = "Unable to load documents.";
    return;
  }

  container.replaceChildren();

  if (!data || data.length === 0) {
    container.textContent = "No published PDFs yet.";
    return;
  }

  data.forEach(doc => {
    const card = document.createElement("div");
    card.className = "doc-card";

    const info = document.createElement("div");
    const title = document.createElement("h3");
    const desc = document.createElement("p");

    title.textContent = doc.title;
    desc.textContent = doc.description || "Online PDF";

    info.append(title, desc);

    const link = document.createElement("a");
    link.href = "reader.html?id=" + encodeURIComponent(doc.id);
    link.textContent = "Read PDF";
    link.rel = "noopener";

    card.append(info, link);
    container.append(card);
  });
}


/* ADMIN: Login and Upload */

async function initAdmin() {
  const loginPanel = document.getElementById("loginPanel");
  const uploadPanel = document.getElementById("uploadPanel");
  const loginForm = document.getElementById("loginForm");
  const uploadForm = document.getElementById("uploadForm");

  async function updatePanel() {
    const { data } = await supabaseClient.auth.getSession();
    const session = data.session;

    loginPanel.hidden = !!session;
    uploadPanel.hidden = !session;

    if (session) {
      loadAdminDocuments();
    }
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    const { error } = await supabaseClient.auth
      .signInWithPassword({ email, password });

    document.getElementById("loginMessage").textContent =
      error ? error.message : "Login successful.";

    if (!error) updatePanel();
  });

  document.getElementById("logoutBtn")
    .addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      updatePanel();
    });

  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const message = document.getElementById("uploadMessage");
    const title = document.getElementById("pdfTitle").value.trim();
    const description =
      document.getElementById("pdfDescription").value.trim();
    const file = document.getElementById("pdfFile").files[0];

    if (!file || !title) return;

    if (file.type !== "application/pdf" ||
        !file.name.toLowerCase().endsWith(".pdf")) {
      message.textContent = "Please select a PDF file.";
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      message.textContent = "PDF must be under 20 MB.";
      return;
    }

    message.textContent = "Uploading...";

    const { data: userData } =
      await supabaseClient.auth.getUser();

    if (!userData.user) {
      message.textContent = "Please login again.";
      return;
    }

    const path = userData.user.id + "/" +
      crypto.randomUUID() + ".pdf";

    const { error: storageError } =
      await supabaseClient.storage
        .from("pdf-files")
        .upload(path, file, {
          contentType: "application/pdf",
          upsert: false
        });

    if (storageError) {
      message.textContent = storageError.message;
      return;
    }

    const { error: dbError } = await supabaseClient
      .from("documents")
      .insert({
        title,
        description,
        storage_path: path,
        is_published: false
      });

    if (dbError) {
      await supabaseClient.storage
        .from("pdf-files").remove([path]);

      message.textContent = dbError.message;
      return;
    }

    message.textContent =
      "PDF uploaded! Publish it from Manage Documents.";

    uploadForm.reset();
    loadAdminDocuments();
  });

  updatePanel();
}


/* ADMIN: Publish and Unpublish */

async function loadAdminDocuments() {
  const container = document.getElementById("adminDocuments");

  const { data, error } = await supabaseClient
    .from("documents")
    .select("id,title,is_published")
    .order("created_at", { ascending: false });

  container.replaceChildren();

  if (error) {
    container.textContent = error.message;
    return;
  }

  data.forEach(doc => {
    const card = document.createElement("div");
    card.className = "doc-card";

    const title = document.createElement("strong");
    title.textContent = doc.title;

    const button = document.createElement("button");
    button.textContent = doc.is_published
      ? "Unpublish" : "Publish";

    button.addEventListener("click", async () => {
      button.disabled = true;

      const { error } = await supabaseClient
        .from("documents")
        .update({ is_published: !doc.is_published })
        .eq("id", doc.id);

      if (error) {
        alert(error.message);
        button.disabled = false;
      } else {
        loadAdminDocuments();
      }
    });

    card.append(title, button);
    container.append(card);
  });
}


/* READER: Secure PDF Viewing */

async function initReader() {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");

  const message = document.getElementById("readerMessage");
  const title = document.getElementById("documentTitle");
  const pages = document.getElementById("pdfPages");

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    message.textContent = "Invalid document link.";
    return;
  }

  if (!window.pdfjsLib) {
    message.textContent = "PDF reader unavailable.";
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  message.textContent = "Opening document...";

  try {
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY
      },
      body: JSON.stringify({ id })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Unable to open PDF.");
    }

    title.textContent = result.title;

    const pdf = await pdfjsLib.getDocument({
      url: result.signedUrl
    }).promise;

    message.textContent = pdf.numPages + " pages";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      const viewport = page.getViewport({ scale: 1.3 });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      pages.append(canvas);

      await page.render({
        canvasContext: context,
        viewport
      }).promise;
    }

    message.textContent = "Document loaded successfully.";

  } catch (error) {
    message.textContent = error.message;
  }
}
