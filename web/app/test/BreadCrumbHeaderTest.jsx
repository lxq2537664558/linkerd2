import Adapter from 'enzyme-adapter-react-16';
import BreadcrumbHeader from '../js/components/BreadcrumbHeader.jsx';
import { Breadcrumb } from 'antd';
import { expect } from 'chai';
import React from 'react';
import Enzyme, { mount } from 'enzyme';

Enzyme.configure({ adapter: new Adapter() });

describe('Tests for <BreadcrumbHeader>', () => {

  it("renders breadcrumbs for a pathname", () => {

    const component = mount(
      <BreadcrumbHeader path="/namespaces/emojivoto/deployments/web" />
    );

    const crumbs = component.find(Breadcrumb.Item);
    expect(crumbs).to.have.length(4);
  });
});
