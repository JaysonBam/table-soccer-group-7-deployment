type StoredClient = {
  name: string;
};

const STORAGE_KEY = "tableSoccerClient";

export function getStoredClientName(): string {
  const storedValue = localStorage.getItem(STORAGE_KEY);

  return storedValue ? (JSON.parse(storedValue) as StoredClient).name : "";
}

export function saveStoredClientName(name: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ name }));
}
