# Testing

This document describes what the tests check, how the tests are divided into kinds, and what a test may replace with a test double. [development.md](development.md) gives the commands that run the tests.

## Kinds

Each kind of test finds a different kind of failure. The kind of a test does not depend on the tool that the test uses. One subject can have tests of several kinds.

| Kind | Failure that the kind finds | Target | Tool | Location |
|---|---|---|---|---|
| Property | Two parts of the specification contradict each other, or a boundary case is missed | Pure functions, and a store that build writes from generated data | hypothesis (backend), fast-check (frontend) | `backend/tests/pbt/`, `frontend/tests/pbt/` |
| Unit | The code does not implement a part of the specification | Functions and components | pytest (backend), vitest (frontend) | `backend/tests/unit/`, `frontend/tests/unit/` |
| API | Each part works correctly, but the parts are connected incorrectly | The api through the FastAPI test client, with a store that build writes from generated input files | pytest | `backend/tests/unit/api/`, `backend/tests/pbt/api/` |
| End-to-end | A page is not displayed, or an operation does not complete | A deployed site | Playwright | `frontend/tests/e2e/` |

If a property test and a unit test check the same thing, then keep the property test. Keep a unit test for an input that the generator of a property test cannot make, or for a boundary that random inputs reach only by chance.

An example-based test restates the specification, so the test cannot find an error in the specification. You find errors in the specification in three ways:

- a property test that produces a counterexample
- a run on real data
- a comparison of the counts before a build and after the build

## What to test

Every invariant in the docs has at least one test. The name of the test states the invariant and does not weaken the invariant, so that a reader can find the sentence of the docs that the test checks. For example, `test_element_count_equals_population_and_element` checks the invariant of aggregations in [api.md](api.md#invariant).

- Do not use coverage to measure the tests. A line that runs does not show what an assertion detects.
- Do not write a test that only passes. If you cannot add a boundary case, an error case, or a negative case to a test, then the test is not needed.
- "The code does not raise an exception" is not a property. A property is a meaningful constraint between the input and the output.
- If the types cannot make two things agree, then write a test that checks that the two things agree. For example, a test checks that the API types of the frontend are the types generated from the OpenAPI document. Another test checks that the clauses that the api returns for an element select exactly what the element counts.

## Test doubles

A test replaces only things outside the application: external services, time, and randomness.

- The tests do not replace the store, the condition DSL, build, or the api. The tests build a real store from generated input files (`backend/tests/synthetic.py`), and then query the store, because the design depends on how the tables of the store are derived and queried.
- For the frontend, the api is outside the application. The unit tests of the frontend can replace the HTTP responses of the api. The end-to-end tests check the real connection between the frontend and the api.
- If a test seems to need a double for a part inside the application, then fix the design, not the test.

## Independence

The tests do not share state, and the tests do not depend on the order in which they run.

- The backend tests build one store from generated data for each pytest session, and the tests only read the store. If a test writes a store, then the test writes a new file in its own temporary directory.
- The unit tests of the frontend render components with their own query client, and do not access the network.

## End-to-end tests

After you deploy to the staging site, and before you promote the deployment, you run the end-to-end tests on the staging site, which has its real dataset. Do not run the end-to-end tests during development or in continuous integration (CI), because the tests take minutes and need a deployed site.

- The site has no operation that changes data, so the tests only read data.
- The tests do not contain terms, accessions, or counts that depend on the dataset. At run time, each test gets these values from the API of the same site, or from the first items of a list on a page. Then the test compares what the page shows with what the API returns. A new build of the dataset therefore does not make the tests fail.
- If the dataset does not have a thing that every dataset has, such as a disease term, then the test fails. If the dataset is too small for a scenario, for example if a list fits on one page or a condition has few years, then the test is skipped.
- The person who runs the tests gives the intended state of the deployment in environment variables ([development.md](development.md#end-to-end-tests)): whether search engines must not index the site, and which commit the site runs. If a variable is not given, then the scenarios that check the variable are skipped. The tests cannot take the intended state from the site, because a site that is deployed incorrectly responds in the same way as a site that is deployed correctly.
- If `BSLLMNER_VIEWER_E2E_NOINDEX` is not given, then the tests do not treat the address as a deployment, and skip the scenarios that check the web server of a deployment.
- The tests keep the load on the site small, because the site serves the full dataset to real users. The tests use few workers, and for lists and exports, the tests use conditions that match few entries.
- Do not run the tests on production, because the requests of the tests would mix with the requests of real users in the access logs.
