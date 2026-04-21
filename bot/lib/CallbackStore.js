// CallbackStore нужен, чтобы хранить временный контекст между кликами в Telegram inline-кнопках.
//
// Почему это важно:
// - Telegram ограничивает длину callback_data (~64 байта)
// - в callback_data нельзя безопасно передавать длинные URL/структуры
// - поэтому в callback кладем короткий token, а реальные данные держим в памяти
//
// Пример потока:
// 1) Пользователь выбирает лигу
// 2) Мы сохраняем payload (categoryId, leagueIndex, ...) в CallbackStore через put()
// 3) Пользователю уходит кнопка с callback_data вида match_league_<token>
// 4) На следующий клик извлекаем payload по token через get()
class CallbackStore {
  static instance = null;

  // Внутреннее in-memory хранилище token -> { payload, expiresAt }
  #store = new Map();

  // Простой счетчик для генерации коротких token (в base36: 1,2,3... -> 1,2,3,a,b...)
  #counter = 0;

  // Время жизни записи по умолчанию (30 минут)
  #TTL_MS = 1000 * 60 * 30;

  constructor() {
    // Singleton: во всем приложении используем один общий store,
    // чтобы контроллеры видели одинаковые token/payload.
    if (CallbackStore.instance) {
      return CallbackStore.instance;
    }

    CallbackStore.instance = this;
  }

  // Сохраняет payload и возвращает короткий token.
  // ttlMs можно переопределить для отдельных сценариев.
  put(payload, ttlMs = this.#TTL_MS) {
    this.#counter += 1;
    const id = this.#counter.toString(36);

    this.#store.set(id, {
      payload,
      expiresAt: Date.now() + ttlMs,
    });

    return id;
  }

  // Возвращает payload по token.
  // Если token не найден или запись протухла — возвращает null.
  // При протухании сразу чистит запись из памяти.
  get(id) {
    if (!this.#store.has(id)) {
      return null;
    }

    const data = this.#store.get(id);

    if (Date.now() > data.expiresAt) {
      this.#store.delete(id);
      return null;
    }

    return data.payload;
  }
}

module.exports = CallbackStore;
