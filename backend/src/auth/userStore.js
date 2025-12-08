const bcrypt = require("bcrypt");

const userStore = new Map();

const normalizeUsername = (username = "") => username.trim().toLowerCase();

function getBcryptRounds() {
  const raw = parseInt(process.env.CDAI_BCRYPT_ROUNDS || "12", 10);
  if (Number.isNaN(raw) || raw < 8) return 12;
  return Math.min(raw, 15);
}

function ensureAdminUser() {
  const adminUsername = process.env.CDAI_ADMIN_USERNAME;
  if (!adminUsername) {
    throw new Error("CDAI_ADMIN_USERNAME environment variable must be set for bootstrap.");
  }
  const normalizedUsername = normalizeUsername(adminUsername);
  if (userStore.has(normalizedUsername)) {
    return userStore.get(normalizedUsername);
  }

  let passwordHash = process.env.CDAI_ADMIN_PASSWORD_HASH;
  if (!passwordHash) {
    const plainPassword = process.env.CDAI_ADMIN_PASSWORD;
    if (!plainPassword) {
      throw new Error(
        "Set CDAI_ADMIN_PASSWORD_HASH (preferred) or CDAI_ADMIN_PASSWORD to bootstrap the admin account."
      );
    }
    passwordHash = bcrypt.hashSync(plainPassword, getBcryptRounds());
    console.log("[auth] Generated bcrypt hash for CDAI_ADMIN_PASSWORD. Consider switching to CDAI_ADMIN_PASSWORD_HASH.");
  }

  const adminUser = {
    id: normalizedUsername,
    username: normalizedUsername,
    displayName: adminUsername,
    role: "admin",
    passwordHash,
  };
  userStore.set(normalizedUsername, adminUser);
  return adminUser;
}

function getUserProfile(user) {
  if (!user) return null;
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

async function verifyUserCredentials(username, password) {
  if (!username || !password) return null;
  const normalizedUsername = normalizeUsername(username);
  const storedUser = userStore.get(normalizedUsername);
  if (!storedUser) return null;
  const match = await bcrypt.compare(password, storedUser.passwordHash);
  if (!match) return null;
  return storedUser;
}

function addUser({ username, passwordHash, role = "user", displayName }) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !passwordHash) {
    throw new Error("username and passwordHash are required");
  }
  const user = {
    id: normalizedUsername,
    username: normalizedUsername,
    displayName: displayName || username,
    role,
    passwordHash,
  };
  userStore.set(normalizedUsername, user);
  return user;
}

module.exports = {
  ensureAdminUser,
  verifyUserCredentials,
  getUserProfile,
  addUser,
  normalizeUsername,
};
