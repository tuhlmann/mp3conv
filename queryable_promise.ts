export class QueryablePromise<T> {
  _isResolved: boolean;
  _isRejected: boolean;

  readonly promise: Promise<T>;

  constructor(promise: Promise<T>) {
    this.promise = promise;
    this._isRejected = false;
    this._isResolved = false;
    promise.then(
      (v) => {
        this._isResolved = true;
        return v;
      },
      (e) => {
        this._isRejected = true;
        throw e;
      },
    );
  }

  isFulfilled() {
    return this._isResolved || this._isRejected;
  }

  isResolved() {
    return this._isResolved;
  }

  isRejected() {
    return this._isRejected;
  }
}
