// Task pane of the fcktaps Word add-in. The local server that serves this page
// runs the build; the pane saves the manuscript, starts a conversion, and
// polls it until fcktaps finishes.

const POLL_INTERVAL_MS = 700;

const $ = (id) => document.getElementById(id);

let documentUrl = "";
let pollTimer = null;

const api = async (path, body) => {
	const response = await fetch(path, body === undefined ? {} : {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(body),
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(data.error || `The fcktaps server answered ${response.status}.`);
	}
	return data;
};

const showError = (message) => {
	$("error").textContent = message;
	$("error").hidden = !message;
};

const setBusy = (busy) => {
	$("convert").disabled = busy;
	$("init").disabled = busy;
	$("progress").hidden = !busy;
};

const fileName = (path) => path.split("/").pop();

const saveDocument = () => Word.run(async (context) => {
	context.document.save();
	await context.sync();
});

const describePaper = async () => {
	documentUrl = Office.context.document.url || "";
	const paper = await api("/api/paper", {url: documentUrl});
	$("document").textContent = fileName(paper.document);
	$("document").title = paper.document;
	$("paper-dir").textContent = paper.paperDir;
	$("missing-paper").hidden = paper.exists;
	$("convert").disabled = !paper.exists;
	return paper;
};

const lastLogLine = (log) => {
	const lines = log.split("\n").map((line) => line.trim()).filter(Boolean);
	return lines.length ? lines[lines.length - 1] : "";
};

const renderMessages = (messages) => {
	const list = $("messages");
	list.replaceChildren();
	for (const message of messages) {
		const item = document.createElement("li");
		item.className = message.level;
		const level = document.createElement("span");
		level.className = "level";
		level.textContent = message.level.toUpperCase();
		const text = document.createElement("span");
		text.textContent = message.text;
		item.append(level, text);
		list.append(item);
	}
};

const renderJob = (job) => {
	$("elapsed").textContent = `${Math.round(job.elapsed)} s`;
	$("last-line").textContent = lastLogLine(job.log);
	if (job.state === "running") {
		return;
	}

	setBusy(false);
	$("result").hidden = false;
	const warnings = job.messages.filter((message) => message.level === "warning").length;
	const summary = $("summary");
	if (job.state === "succeeded") {
		summary.className = "summary succeeded";
		summary.textContent = `PDF built in ${Math.round(job.elapsed)} s`
			+ (warnings ? ` with ${warnings} warning${warnings === 1 ? "" : "s"}.` : ".");
	} else {
		summary.className = "summary failed";
		summary.textContent = "The conversion failed.";
	}
	$("open-pdf").hidden = job.state !== "succeeded";
	$("open-pdf").dataset.job = job.id;
	renderMessages(job.messages);
	$("log").textContent = job.log;
	$("log-details").open = job.state === "failed" && job.messages.length === 0;
};

const poll = (id) => {
	clearTimeout(pollTimer);
	pollTimer = setTimeout(async () => {
		try {
			const job = await api(`/api/jobs/${id}`);
			renderJob(job);
			if (job.state === "running") {
				poll(id);
			}
		} catch (error) {
			setBusy(false);
			showError(`Lost contact with the fcktaps server: ${error.message}`);
		}
	}, POLL_INTERVAL_MS);
};

const follow = (job) => {
	setBusy(true);
	$("result").hidden = true;
	$("progress-label").textContent = "Converting…";
	renderJob(job);
	poll(job.id);
};

const convert = async () => {
	showError("");
	setBusy(true);
	$("result").hidden = true;
	$("elapsed").textContent = "";
	$("last-line").textContent = "";
	$("progress-label").textContent = "Saving…";
	try {
		await saveDocument();
		// A first save gives an untitled document its path.
		await describePaper();
		setBusy(true);
		$("progress-label").textContent = "Converting…";
		follow(await api("/api/convert", {url: documentUrl}));
	} catch (error) {
		setBusy(false);
		showError(error.message);
	}
};

const initPaper = async () => {
	showError("");
	$("init").disabled = true;
	try {
		await api("/api/init", {url: documentUrl});
		await describePaper();
	} catch (error) {
		$("init").disabled = false;
		showError(error.message);
	}
};

const openPdf = async () => {
	try {
		await api("/api/open", {id: $("open-pdf").dataset.job});
	} catch (error) {
		showError(error.message);
	}
};

Office.onReady(async () => {
	$("convert").addEventListener("click", convert);
	$("init").addEventListener("click", initPaper);
	$("open-pdf").addEventListener("click", openPdf);
	try {
		const paper = await describePaper();
		if (paper.running) {
			follow(paper.running);
		}
	} catch (error) {
		// An unsaved manuscript has no path yet; converting saves it first.
		$("convert").disabled = false;
		showError(error.message);
	}
});
