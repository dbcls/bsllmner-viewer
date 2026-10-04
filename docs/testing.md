# Testing

This document describes what is tested, how the tests are divided, and what may be replaced by a test double. The commands that run the tests are in [development.md](development.md).

## Kinds

Tests are divided by the kind of failure that they find, not by the tool that they use. One subject can have tests of several kinds.

| Kind | Failure that it finds | Tool | Location |
|---|---|---|---|
| Property | Specifications that contradict each other, and missed boundaries | hypothesis (backend), fast-check (frontend). Pure functions and a store built from generated data | `backend/tests/pbt/`, `frontend/tests/pbt/` |
| Unit | A specification that is not implemented | pytest (backend), vitest (frontend). Functions and components | `backend/tests/unit/`, `frontend/tests/unit/` |
| API | Correct parts that are connected incorrectly | pytest with the FastAPI test client, against a store that the build writes from generated input files | `backend/tests/unit/api/`, `backend/tests/pbt/api/` |
| End-to-end | A page that does not display, or an operation that does not complete | Playwright, against a deployed site | `frontend/tests/e2e/` |

- If a property test and a unit test check the same thing, then keep the property test. Keep a unit test for inputs that the generator cannot make, and for boundaries that random inputs hit only by chance.
- Example-based tests do not find an error in a specification, because they restate the specification. A property with a counterexample, a run on real data, and a count compared before and after a build are what find such errors.

## What to test

Every invariant written in the docs has at least one test. The test name states the invariant without weakening it, so that a reader can tell which sentence of the docs the test checks. For example, `test_element_count_equals_population_and_element` checks the invariant of aggregations in [api.md](api.md).

- Coverage is not a measure. Whether a line ran says nothing about what an assertion detects.
- A test that only passes is not written. If no boundary, error case, or negative case can be added, then the test is not needed.
- "Does not raise" is not a property. A property is a meaningful constraint between the input and the output.
- Two things that types cannot connect are connected by a test. For example, the API types of the frontend are generated from the OpenAPI document, and the clauses that the api returns for an element select exactly what the element counts.

## Test doubles

Only what is outside the application may be replaced: external services, time, and randomness.

- The store, the condition DSL, the build, and the api are not replaced. The tests build a real store from generated input files (`backend/tests/synthetic.py`) and query it, because the design depends on how the store's tables are derived and queried.
- For the frontend, the api is outside. Frontend unit tests may replace the HTTP responses of the api; the end-to-end tests check the real connection.
- If a test seems to need a double for an internal part, then fix the design, not the test.

## Independence

Tests do not share state and do not depend on the order in which they run.

- The backend tests build one store per session from generated data and only read it. A test that writes a store writes a new file in its own temporary directory.
- The frontend unit tests render components with their own query client and do not reach the network.

## End-to-end tests

End-to-end tests run against a deployed staging site with its real dataset, after a deployment and before the deployment is promoted. The end-to-end tests do not run during development or in CI, because they take minutes and need a deployed site.

- The site has no operations that change data, so the tests only read.
- The tests do not contain terms, accessions, or counts that depend on the dataset. Each test takes them at run time from the API of the same site, or from the top of a list on a page, and compares what the page shows with what the API returns. A rebuild of the dataset therefore does not break the tests.
- If the dataset lacks something that every dataset has, such as a disease term, then the test fails. If the dataset is too small for the scenario, such as a list that fits on one page or a condition with few years, then the test skips.
- What a deployment is meant to be (whether it is kept out of search engines, and which commit it runs) is given by the person who runs the tests, in environment variables. The scenarios that check it skip if it is not given. A wrongly deployed site responds in the same way as a correctly deployed one, so the expectation cannot come from the site. Without these variables, the address is not taken as a deployment, so the scenarios of the web server of a deployment also skip.
- The tests keep the load small: few workers, and conditions that match few entries for lists and exports. The site serves real users and the full dataset.
- The tests do not run against production. The requests of the tests would mix with the access logs of real users.
