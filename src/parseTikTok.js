const USER_FIELDS = ["UserName", "Username", "username", "uniqueId", "unique_id"];
const DATE_FIELDS = ["Date", "date", "CreateTime", "createTime"];
const NAME_FIELDS = ["NickName", "Nickname", "nickName", "DisplayName", "display_name"];

function cleanUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .replace(/\s+/g, "");
}

function isUsername(value) {
  return /^[A-Za-z0-9._]{2,24}$/.test(value);
}

function readField(record, names) {
  for (const name of names) {
    if (typeof record[name] === "string" && record[name].trim()) {
      return record[name].trim();
    }
  }
  return "";
}

function personFromRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;

  let username = cleanUsername(readField(record, USER_FIELDS));
  if (!isUsername(username)) {
    const link = String(record.Link || record.link || record.UserLink || "");
    const match = link.match(/tiktok\.com\/@([A-Za-z0-9._]{2,24})/i);
    username = match ? match[1] : "";
  }
  if (!isUsername(username)) return null;

  return {
    username,
    date: readField(record, DATE_FIELDS),
    nickname: readField(record, NAME_FIELDS),
  };
}

function listKind(key) {
  const name = String(key).toLowerCase();
  if (name.includes("follower") || name.includes("fans")) return "followers";
  if (name.includes("following")) return "following";
  return null;
}

function addPerson(bucket, person) {
  const key = person.username.toLowerCase();
  const current = bucket.get(key);
  if (!current) {
    bucket.set(key, {
      username: person.username,
      date: person.date || "",
      nickname: person.nickname || "",
    });
    return;
  }
  if (!current.date && person.date) current.date = person.date;
  if (!current.nickname && person.nickname) current.nickname = person.nickname;
}

function walk(node, key, following, followers) {
  const kind = listKind(key);

  if (Array.isArray(node)) {
    if (!kind) {
      node.forEach((item, index) => walk(item, String(index), following, followers));
      return;
    }
    node.forEach((item) => {
      const person = personFromRecord(item);
      if (!person) return;
      addPerson(kind === "followers" ? followers : following, person);
    });
    return;
  }

  if (!node || typeof node !== "object") return;

  for (const [childKey, child] of Object.entries(node)) {
    walk(child, childKey, following, followers);
  }
}

function findOwner(node, key = "", path = "") {
  if (!node || typeof node !== "object") return "";

  const here = `${path}/${String(key)}`.toLowerCase();
  const inProfile = here.includes("profile");
  const inList = here.includes("following") || here.includes("follower") || here.includes("fans");

  if (inProfile && !inList && !Array.isArray(node)) {
    const username = cleanUsername(readField(node, USER_FIELDS));
    if (isUsername(username)) return username;
  }

  if (Array.isArray(node)) return "";

  for (const [childKey, child] of Object.entries(node)) {
    const found = findOwner(child, childKey, here);
    if (found) return found;
  }
  return "";
}

export function parseJsonText(text) {
  const data = JSON.parse(text);
  const following = new Map();
  const followers = new Map();
  walk(data, "", following, followers);
  return {
    owner: findOwner(data),
    following: [...following.values()],
    followers: [...followers.values()],
  };
}

function kindFromText(text, filename = "") {
  const label = `${filename}\n${text.slice(0, 400)}`;
  if (/follower list|fans list|follower\.txt/i.test(label)) return "followers";
  if (/following list|following\.txt/i.test(label)) return "following";
  return null;
}

export function parseTxt(text, filename = "") {
  const kind = kindFromText(text, filename);
  const people = [];
  const chunks = text.split(/(?=Date:)/i);
  for (const chunk of chunks) {
    const user = chunk.match(/UserName:\s*@?([A-Za-z0-9._]{2,24})/i);
    if (!user) continue;
    const date = chunk.match(/Date:\s*([^\n\r]+)/i);
    const nick = chunk.match(/NickName:\s*([^\n\r]+)/i);
    people.push({
      username: user[1],
      date: date?.[1].trim() || "",
      nickname: nick?.[1].trim() || "",
    });
  }

  if (!people.length) {
    for (const line of text.split(/\r?\n/)) {
      const user = line.match(/@([A-Za-z0-9._]{2,24})/);
      if (user) people.push({ username: user[1], date: "" });
    }
  }

  return {
    owner: "",
    following: kind === "following" ? people : [],
    followers: kind === "followers" ? people : [],
    loose: kind ? [] : people,
  };
}

export function mergeImports(parts) {
  const following = new Map();
  const followers = new Map();
  let owner = "";

  for (const part of parts) {
    if (!owner && part.owner) owner = part.owner;
    for (const person of part.following || []) addPerson(following, person);
    for (const person of part.followers || []) addPerson(followers, person);
  }

  return {
    owner,
    following: [...following.values()],
    followers: [...followers.values()],
  };
}

export function parseDate(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    const fallback = new Date(String(value).trim());
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return date;
}
