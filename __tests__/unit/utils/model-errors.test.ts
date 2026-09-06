import { isTransientModelFailure } from '@utils/model-errors'

describe('model-errors', () => {
  /*
   * THE LEVEL SELECTOR, pinned by the exact payload that caused the incident.
   *
   * `Bedrock is unable to process your request` arrives as ServiceUnavailableException / 503 /
   * `$fault: 'server'` and -- critically -- `'$retryable': undefined`. An earlier reading of this
   * predicate keyed on $retryable, which is ABSENT on the one error it exists to classify, so the
   * row carrying that field explicitly is the regression guard.
   *
   * The 4xx rows are the other half: AccessDenied on a model this role cannot invoke, and a
   * ValidationException on a malformed body, are deploys that need fixing and MUST keep paging.
   * A predicate widened to all of `$fault` would silence both.
   */
  describe('isTransientModelFailure', () => {
    it.each([
      [
        'a Bedrock 503 with $retryable absent',
        { $fault: 'server', $metadata: { httpStatusCode: 503 }, $retryable: undefined },
        true,
      ],
      ['a 500 from the service', { $fault: 'server', $metadata: { httpStatusCode: 500 } }, true],
      [
        'a 429 throttle, which the SDK faults to the client',
        { $fault: 'client', $metadata: { httpStatusCode: 429 } },
        true,
      ],
      [
        'an AccessDenied on a model outside the policy',
        { $fault: 'client', $metadata: { httpStatusCode: 403 } },
        false,
      ],
      ['a ValidationException on a malformed body', { $fault: 'client', $metadata: { httpStatusCode: 400 } }, false],
      ['an ordinary Error with no SDK metadata', new Error('gate threw'), false],
      ['undefined', undefined, false],
      ['null', null, false],
    ])('returns %s -> %s', (_description, error, expected) => {
      expect(isTransientModelFailure(error)).toBe(expected)
    })
  })
})
