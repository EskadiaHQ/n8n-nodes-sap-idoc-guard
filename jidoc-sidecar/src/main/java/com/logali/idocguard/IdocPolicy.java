package com.logali.idocguard;

import java.io.StringReader;
import java.util.Set;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.InputSource;

record IdocPolicy(
    String messageType,
    String basicType,
    String extension,
    Set<String> allowedSegments,
    String senderPartnerType,
    String senderPartner,
    String receiverPartnerType,
    String receiverPartner,
    String receiverPort,
    int maxSegments
) {
  record Validation(String messageType, String basicType, String extension, int segmentCount) {}

  void validateConfiguration() {
    technical(messageType, "IDOC_MESSAGE_TYPE");
    technical(basicType, "IDOC_BASIC_TYPE");
    if (!extension.isBlank()) technical(extension, "IDOC_EXTENSION");
    if (allowedSegments.isEmpty() || !allowedSegments.contains("EDI_DC40")) {
      throw new IllegalArgumentException("IDOC_ALLOWED_SEGMENTS must include EDI_DC40");
    }
    for (String segment : allowedSegments) technical(segment, "IDOC_ALLOWED_SEGMENTS");
    technical(senderPartnerType, "IDOC_SENDER_PARTNER_TYPE");
    partner(senderPartner, "IDOC_SENDER_PARTNER");
    technical(receiverPartnerType, "IDOC_RECEIVER_PARTNER_TYPE");
    partner(receiverPartner, "IDOC_RECEIVER_PARTNER");
    partner(receiverPort, "IDOC_RECEIVER_PORT");
    if (maxSegments < 1 || maxSegments > 10_000) {
      throw new IllegalArgumentException("IDOC_GUARD_MAX_SEGMENTS is outside the permitted range");
    }
  }

  Validation validate(String xml) {
    if (xml == null || xml.isBlank()) throw new IllegalArgumentException("IDOC_XML_INVALID");
    if (xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY")) {
      throw new IllegalArgumentException("XML_EXTERNAL_ENTITY_REJECTED");
    }
    try {
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(false);
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
      factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
      factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
      factory.setXIncludeAware(false);
      factory.setExpandEntityReferences(false);
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
      Document document = factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml)));
      if (document.getElementsByTagName("IDOC").getLength() != 1) {
        throw new IllegalArgumentException("IDOC_DOCUMENT_COUNT_INVALID");
      }
      if (document.getElementsByTagName("EDI_DC40").getLength() != 1) {
        throw new IllegalArgumentException("IDOC_CONTROL_RECORD_INVALID");
      }
      if (!document.getDocumentElement().getTagName().equalsIgnoreCase(basicType)) {
        throw new IllegalArgumentException("IDOC_ROOT_TYPE_MISMATCH");
      }
      exact(document, "MESTYP", messageType, "IDOC_MESSAGE_TYPE_MISMATCH");
      exact(document, "IDOCTYP", basicType, "IDOC_BASIC_TYPE_MISMATCH");
      exact(document, "CIMTYP", extension, "IDOC_EXTENSION_MISMATCH");
      exact(document, "SNDPRT", senderPartnerType, "IDOC_SENDER_TYPE_MISMATCH");
      exact(document, "SNDPRN", senderPartner, "IDOC_SENDER_MISMATCH");
      exact(document, "RCVPRT", receiverPartnerType, "IDOC_RECEIVER_TYPE_MISMATCH");
      exact(document, "RCVPRN", receiverPartner, "IDOC_RECEIVER_MISMATCH");
      exact(document, "RCVPOR", receiverPort, "IDOC_RECEIVER_PORT_MISMATCH");
      String suppliedDocument = optionalText(document, "DOCNUM");
      if (!suppliedDocument.isBlank()) throw new IllegalArgumentException("IDOC_DOCNUM_MUST_BE_EMPTY");
      if (document.getElementsByTagName("EDIDS").getLength() > 0) {
        throw new IllegalArgumentException("IDOC_STATUS_RECORD_NOT_ALLOWED");
      }

      int count = 0;
      var elements = document.getElementsByTagName("*");
      for (int index = 0; index < elements.getLength(); index++) {
        Node node = elements.item(index);
        if (!(node instanceof Element element)) continue;
        String name = element.getTagName().toUpperCase();
        boolean segment = name.equals("EDI_DC40") || element.hasAttribute("SEGMENT");
        if (!segment) continue;
        count++;
        if (!allowedSegments.contains(name)) {
          throw new IllegalArgumentException("IDOC_SEGMENT_NOT_ALLOWED");
        }
      }
      if (count > maxSegments) throw new IllegalArgumentException("IDOC_SEGMENT_LIMIT_EXCEEDED");
      return new Validation(messageType, basicType, extension, count);
    } catch (IllegalArgumentException error) {
      throw error;
    } catch (Exception error) {
      throw new IllegalArgumentException("IDOC_XML_INVALID", error);
    }
  }

  private static void exact(Document document, String tag, String expected, String errorCode) {
    String actual = optionalText(document, tag).toUpperCase();
    if (!actual.equals(expected)) throw new IllegalArgumentException(errorCode);
  }

  private static String optionalText(Document document, String tag) {
    var nodes = document.getElementsByTagName(tag);
    if (nodes.getLength() == 0) return "";
    if (nodes.getLength() != 1) throw new IllegalArgumentException("IDOC_CONTROL_FIELD_DUPLICATED");
    return nodes.item(0).getTextContent().trim();
  }

  private static void technical(String value, String label) {
    if (value == null || !value.matches("[A-Z][A-Z0-9_]{0,29}")) {
      throw new IllegalArgumentException(label + " is invalid");
    }
  }

  private static void partner(String value, String label) {
    if (value == null || !value.matches("[A-Z0-9_.@-]{1,32}")) {
      throw new IllegalArgumentException(label + " is invalid");
    }
  }
}
