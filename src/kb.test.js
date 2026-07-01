import { KB_ARTICLES, findMatch } from './kb';

test('includes the expanded complex incident use case library', function() {
  expect(KB_ARTICLES).toHaveLength(12);
});

test('requires a meaningful signal before returning a runbook', function() {
  expect(findMatch('npe')).toBeNull();
});

test('returns a matching runbook for specific incident descriptions', function() {
  var match = findMatch('BillingCenter ACH payment gateway timeout with NPE');
  expect(match).not.toBeNull();
  expect(match.id).toBe('KB-002');
});

test('matches OAuth producer portal refresh storm scenarios', function() {
  var match = findMatch('OAuth refresh causing 401 storm for producer portal sessions');
  expect(match).not.toBeNull();
  expect(match.id).toBe('KB-007');
});

test('matches privacy export redaction scenarios', function() {
  var match = findMatch('ClaimCenter PII redaction missing from claim notes export');
  expect(match).not.toBeNull();
  expect(match.id).toBe('KB-012');
});

test('bounds oversized incident descriptions before matching', function() {
  var oversized = 'x'.repeat(2500) + ' BillingCenter ACH payment gateway timeout';
  expect(findMatch(oversized)).toBeNull();
});
