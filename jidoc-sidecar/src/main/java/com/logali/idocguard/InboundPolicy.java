package com.logali.idocguard;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.xml.sax.InputSource;

record InboundPolicy(
    Set<String> messageTypes,
    Set<String> basicTypes,
    Set<String> senderPartners,
    int maxBytes
) {
  record Validation(String docnum, String messageType, String basicType, String senderPartner) {}

  void validateConfiguration() {
    if (messageTypes.isEmpty() || basicTypes.isEmpty() || senderPartners.isEmpty()) {
      throw new IllegalArgumentException("Inbound IDoc allowlists cannot be empty");
    }
    messageTypes.forEach(value -> technical(value, "IDOC_INBOUND_MESSAGE_TYPES"));
    basicTypes.forEach(value -> technical(value, "IDOC_INBOUND_BASIC_TYPES"));
    senderPartners.forEach(value -> partner(value, "IDOC_INBOUND_SENDER_PARTNERS"));
  }

  Validation validate(String xml) {
    if (xml == null || xml.isBlank()
        || xml.getBytes(StandardCharsets.UTF_8).length > maxBytes) {
      throw new IllegalArgumentException("INBOUND_IDOC_SIZE_INVALID");
    }
    if (xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY")) {
      throw new IllegalArgumentException("XML_EXTERNAL_ENTITY_REJECTED");
    }
    try {
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
      factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
      factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
      factory.setXIncludeAware(false);
      factory.setExpandEntityReferences(false);
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
      factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
      Document document = factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml)));
      if (document.getElementsByTagName("IDOC").getLength() != 1
          || document.getElementsByTagName("EDI_DC40").getLength() != 1) {
        throw new IllegalArgumentException("INBOUND_IDOC_DOCUMENT_COUNT_INVALID");
      }
      String messageType = text(document, "MESTYP").toUpperCase();
      String basicType = text(document, "IDOCTYP").toUpperCase();
      String sender = text(document, "SNDPRN").toUpperCase();
      if (!messageTypes.contains(messageType)) {
        throw new IllegalArgumentException("INBOUND_MESSAGE_TYPE_NOT_ALLOWED");
      }
      if (!basicTypes.contains(basicType)) {
        throw new IllegalArgumentException("INBOUND_BASIC_TYPE_NOT_ALLOWED");
      }
      if (!senderPartners.contains(sender)) {
        throw new IllegalArgumentException("INBOUND_SENDER_NOT_ALLOWED");
      }
      return new Validation(text(document, "DOCNUM"), messageType, basicType, sender);
    } catch (IllegalArgumentException error) {
      throw error;
    } catch (Exception error) {
      throw new IllegalArgumentException("INBOUND_IDOC_XML_INVALID", error);
    }
  }

  private static String text(Document document, String tag) {
    var nodes = document.getElementsByTagName(tag);
    if (nodes.getLength() != 1) throw new IllegalArgumentException("INBOUND_CONTROL_FIELD_INVALID");
    return nodes.item(0).getTextContent().trim();
  }

  private static void technical(String value, String label) {
    if (!value.matches("[A-Z][A-Z0-9_]{0,29}")) {
      throw new IllegalArgumentException(label + " is invalid");
    }
  }

  private static void partner(String value, String label) {
    if (!value.matches("[A-Z0-9_.@-]{1,32}")) {
      throw new IllegalArgumentException(label + " is invalid");
    }
  }
}
