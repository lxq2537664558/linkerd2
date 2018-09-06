import _ from 'lodash';
import ErrorBanner from './ErrorBanner.jsx';
import Percentage from './util/Percentage.js';
import PropTypes from 'prop-types';
import React from 'react';
import TopEventTable from './TopEventTable.jsx';
import { withContext } from './util/AppContext.jsx';
import { processTapEvent, setMaxRps } from './util/TapUtils.jsx';

class TopModule extends React.Component {
  static propTypes = {
    maxRowsToDisplay: PropTypes.number,
    pathPrefix: PropTypes.string.isRequired,
    query: PropTypes.shape({}).isRequired,
    startTap: PropTypes.bool.isRequired,
    updateNeighbors: PropTypes.func
  }

  static defaultProps = {
    maxRowsToDisplay: 40, // max aggregated top rows to index and display in table
    updateNeighbors: _.noop
  }

  constructor(props) {
    super(props);

    this.state = {
      error: null,
      tapResultsById: {},
      topEventIndex: {},
      maxRowsToStore: 40 // max un-ended tap results to keep in index (pre-aggregation into the top counts)
    };
  }

  componentDidMount() {
    if (this.props.startTap) {
      this.startTapStreaming();
    }
  }

  componentDidUpdate(prevProps) {
    if (this.props.startTap && !prevProps.startTap) {
      this.startTapStreaming();
    }
    if (!this.props.startTap && prevProps.startTap) {
      this.stopTapStreaming();
    }
  }

  componentWillUnmount() {
    this.stopTapStreaming();
  }

  onWebsocketOpen = () => {
    let query = _.cloneDeep(this.props.query);
    setMaxRps(query);

    this.ws.send(JSON.stringify({
      id: "top-web",
      ...query
    }));
    this.setState({
      error: null
    });
  }

  onWebsocketRecv = e => {
    this.indexTapResult(e.data);
  }

  onWebsocketClose = e => {
    if (!e.wasClean) {
      this.setState({
        error: { error: `Websocket [${e.code}] ${e.reason}` }
      });
    }
  }

  onWebsocketError = e => {
    this.setState({
      error: { error: e.message }
    });
  }

  closeWebSocket = () => {
    if (this.ws) {
      this.ws.close(1000);
    }
  }

  parseTapResult = data => {
    let d = processTapEvent(data);

    if (d.eventType === "responseEnd") {
      d.latency = parseFloat(d.http.responseEnd.sinceRequestInit.replace("s", ""));
      d.completed = true;
    }

    return d;
  }

  topEventKey = event => {
    return [event.source.str, event.destination.str, event.http.requestInit.path].join("_");
  }

  initialTopResult(d, eventKey) {
    return {
      count: 1,
      best: d.responseEnd.latency,
      worst: d.responseEnd.latency,
      last: d.responseEnd.latency,
      success: !d.success ? 0 : 1,
      failure: !d.success ? 1 : 0,
      successRate: !d.success ? new Percentage(0, 1) : new Percentage(1, 1),
      source: d.requestInit.source,
      sourceLabels: d.requestInit.sourceMeta.labels,
      destination: d.requestInit.destination,
      destinationLabels: d.requestInit.destinationMeta.labels,
      path: d.requestInit.http.requestInit.path,
      key: eventKey,
      lastUpdated: Date.now()
    };
  }

  incrementTopResult(d, result) {
    result.count++;
    if (!d.success) {
      result.failure++;
    } else {
      result.success++;
    }
    result.successRate = new Percentage(result.success, result.success + result.failure);

    result.last = d.responseEnd.latency;
    if (d.responseEnd.latency < result.best) {
      result.best = d.responseEnd.latency;
    }
    if (d.responseEnd.latency > result.worst) {
      result.worst = d.responseEnd.latency;
    }

    result.lastUpdated = Date.now();
  }

  indexTopResult = (d, topResults) => {
    let eventKey = this.topEventKey(d.requestInit);
    this.addSuccessCount(d);

    if (!topResults[eventKey]) {
      topResults[eventKey] = this.initialTopResult(d, eventKey);
    } else {
      this.incrementTopResult(d, topResults[eventKey]);
    }

    if (_.size(topResults) > this.props.maxRowsToDisplay) {
      this.deleteOldestIndexedResult(topResults);
    }

    if (d.base.proxyDirection === "INBOUND") {
      this.props.updateNeighbors(_.get(d, "requestInit.sourceMeta.labels", null));
    }

    return topResults;
  }

  indexTapResult = data => {
    // keep an index of tap results by id until the request is complete.
    // when the request has completed, add it to the aggregated Top counts and
    // discard the individual tap result
    let resultIndex = this.state.tapResultsById;
    let d = this.parseTapResult(data);

    if (_.isNil(resultIndex[d.id])) {
      // don't let tapResultsById grow unbounded
      if (_.size(resultIndex) > this.state.maxRowsToStore) {
        this.deleteOldestIndexedResult(resultIndex);
      }

      resultIndex[d.id] = {};
    }
    resultIndex[d.id][d.eventType] = d;

    // assumption: requests of a given id all share the same high level metadata
    resultIndex[d.id].base = d;
    resultIndex[d.id].lastUpdated = Date.now();

    let topIndex = this.state.topEventIndex;
    if (d.completed) {
      // only add results into top if the request has completed
      // we can also now delete this result from the Tap result index
      topIndex = this.indexTopResult(resultIndex[d.id], topIndex);
      delete resultIndex[d.id];
    }

    this.setState({
      tapResultsById: resultIndex,
      topEventIndex: topIndex
    });
  }

  addSuccessCount = d => {
    // cope with the fact that gRPC failures are returned with HTTP status 200
    // and correctly classify gRPC failures as failures
    let success = parseInt(d.responseInit.http.responseInit.httpStatus, 10) < 500;
    if (success) {
      let grpcStatusCode = _.get(d, "responseEnd.http.responseEnd.eos.grpcStatusCode");
      if (!_.isNil(grpcStatusCode)) {
        success = grpcStatusCode === 0;
      } else if (!_.isNil(_.get(d, "responseEnd.http.responseEnd.eos.resetErrorCode"))) {
        success = false;
      }
    }

    d.success = success;
  }

  deleteOldestIndexedResult = resultIndex => {
    let oldest = Date.now();
    let oldestId = "";

    _.each(resultIndex, (res, id) => {
      if (res.lastUpdated < oldest) {
        oldest = res.lastUpdated;
        oldestId = id;
      }
    });

    delete resultIndex[oldestId];
  }

  startTapStreaming() {
    let protocol = window.location.protocol === "https:" ? "wss" : "ws";
    let tapWebSocket = `${protocol}://${window.location.host}${this.props.pathPrefix}/api/tap`;

    this.ws = new WebSocket(tapWebSocket);
    this.ws.onmessage = this.onWebsocketRecv;
    this.ws.onclose = this.onWebsocketClose;
    this.ws.onopen = this.onWebsocketOpen;
    this.ws.onerror = this.onWebsocketError;
  }

  stopTapStreaming() {
    this.closeWebSocket();
  }

  banner = () => {
    if (!this.state.error) {
      return;
    }

    return <ErrorBanner message={this.state.error} />;
  }

  render() {
    let tableRows = _.values(this.state.topEventIndex);

    return (
      <React.Fragment>
        {this.banner()}
        <TopEventTable tableRows={tableRows} />
      </React.Fragment>
    );
  }
}

export default withContext(TopModule);
