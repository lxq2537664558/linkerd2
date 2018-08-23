import _ from 'lodash';
import {Breadcrumb, Layout} from 'antd';
import React from 'react';
import './../../css/breadcrumb-header.css';
import {friendlyTitle, singularResource, toShortResourceName} from "./util/Utils.js";
import ReactRouterPropTypes from 'react-router-prop-types';
import {withContext} from './util/AppContext.jsx';
import PropTypes from "prop-types";
import {Link} from "react-router-dom";


const BreadcrumbLink = (fullUrl, terminalSegment, PrefixLink) => {

  let lowercaseSegment = terminalSegment.toLowerCase();
  let splitUrl = fullUrl.split("/").slice(1);

  let segments = _.takeWhile(splitUrl, p => p !== lowercaseSegment);
  console.log("split", splitUrl, segments);
  if (splitUrl.length < segments.length) {
    segments.push(lowercaseSegment);
  }

  return (
    <PrefixLink
      to={segments.join("/")}>
      {terminalSegment}
    </PrefixLink>
  );
};

class BreadcrumbHeader extends React.Component {


  static propTypes = {
    api: PropTypes.shape({
      PrefixedLink: PropTypes.func.isRequired,
    }).isRequired,
    location: ReactRouterPropTypes.location.isRequired
  }

  constructor(props) {
    super(props);
  }

  combineResource(segments) {
    if (segments.length === 4) {
      let splitSegments = _.chunk(segments, 2);
      return _.concat(splitSegments[0], splitSegments[1].join('/'));
    } else {
      return segments;
    }
  }

  splitPath(location) {
    if (location.length === 0) {
      return [];
    } else {
      let segments = location.split('/').slice(1);
      let validSegments = _.map(segments, segment => {
        return singularResource(segment);
      });
      let finalSegments = this.combineResource(validSegments);
      return _.map(finalSegments, segment => {
        let crumb = toShortResourceName(segment) === segment ? segment : friendlyTitle(segment).plural;
        let partialUrl = _.takeWhile(segments, s => {
          return s !== crumb.toLowerCase();
        });

        if (partialUrl.length !== segments.length) {
          partialUrl.push(crumb.toLowerCase());
        }
        console.log(`segment is ${segment}`, partialUrl, segments);
        return {
          link: `/${partialUrl.join("/")}`,
          segment: crumb
        };
      });
    }
  }

  render() {
    return (
      <Layout.Header>
        <Breadcrumb separator=">">
          {
            _.map(this.splitPath(this.props.location.pathname), pathSegment => {
              return (
                <Breadcrumb.Item key={pathSegment.segment}>
                  <Link
                    to={pathSegment.link}>
                    {pathSegment.segment}
                  </Link>
                </Breadcrumb.Item>
              );
            })
          }
        </Breadcrumb>
      </Layout.Header>
    );
  }
}

export default withContext(BreadcrumbHeader);


